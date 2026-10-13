import { BodyLimitError, isRecord, jsonError, mediaType, readLimitedBody } from "../http.ts";
import { requiredSecret } from "../secrets.ts";
import { isMailbox, recipientRefusal, SENDER } from "./policy.ts";

export const MAX_EMAIL_BYTES = 128 * 1024;
type EmailEnv = Pick<Env, "EMAIL" | "NOTIFY_FROM" | "NOTIFY_FROM_NAME" | "EMAIL_SENDING_ENABLED" |
  "EMAIL_TRANSPORT" | "EMAIL_ACCOUNT_ID" | "EMAIL_API_TOKEN" | "EMAIL_ALLOWED_ADDRESSES" | "EMAIL_ALLOWED_DOMAINS">;

interface RelayMessage {
  notificationId: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: null;
}

const permanentCodes = new Set([
  "E_VALIDATION_ERROR", "E_FIELD_MISSING", "E_TOO_MANY_RECIPIENTS", "E_TOO_MANY_ATTACHMENTS",
  "E_SENDER_NOT_VERIFIED", "E_RECIPIENT_NOT_ALLOWED", "E_RECIPIENT_SUPPRESSED",
  "E_SENDER_DOMAIN_NOT_AVAILABLE", "E_CONTENT_TOO_LARGE",
]);
const transientCodes = new Set([
  "E_RATE_LIMIT_EXCEEDED", "E_DAILY_LIMIT_EXCEEDED", "E_INTERNAL_SERVER_ERROR", "E_DELIVERY_FAILED",
]);

function bindingFailure(error: unknown): Response {
  const code = isRecord(error) || error instanceof Error ? Reflect.get(error, "code") : undefined;
  if (typeof code === "string" && (permanentCodes.has(code) || /^E_HEADERS?(?:_[A-Z]+)+$/.test(code))) {
    return jsonError(code, 422, false);
  }
  return jsonError(typeof code === "string" && transientCodes.has(code) ? code : "E_PROVIDER_UNKNOWN", 503);
}

function isRelayMessage(value: unknown): value is RelayMessage {
  if (!isRecord(value) || Object.keys(value).some(key =>
    !["notificationId", "to", "subject", "text", "html", "replyTo"].includes(key))) return false;
  return typeof value.notificationId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.notificationId) &&
    isMailbox(value.to) &&
    typeof value.subject === "string" && value.subject.trim().length > 0 && value.subject.length <= 998 &&
    !/[\r\n\u0000]/.test(value.subject) &&
    typeof value.text === "string" && value.text.trim().length > 0 &&
    typeof value.html === "string" && value.html.trim().length > 0 &&
    (value.replyTo === undefined || value.replyTo === null);
}

// Return 200 once the provider accepts the message to avoid duplicate sends without an upstream idempotency key.
function accepted(messageId: unknown, message: RelayMessage, transport: "binding" | "rest", confirmed: boolean): Response {
  if (!confirmed) console.warn(JSON.stringify({ event: "EmailAcceptedUnconfirmed", transport, notificationId: message.notificationId }));
  return Response.json({ messageId: typeof messageId === "string" && messageId ? messageId : null }, {
    headers: { "cache-control": "no-store" },
  });
}

// REST is selected explicitly. Never resend through another transport after an ambiguous send.
async function sendRest(message: RelayMessage, env: EmailEnv, headers: Record<string, string>): Promise<Response> {
  if (!/^[a-f0-9]{32}$/i.test(env.EMAIL_ACCOUNT_ID)) return jsonError("E_RELAY_CONFIG", 503);
  let token: string;
  try {
    token = await requiredSecret(env.EMAIL_API_TOKEN, "keyloop_prod_email_api_token");
  } catch {
    return jsonError("E_RELAY_SECRET_UNAVAILABLE", 503);
  }
  const upstream = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.EMAIL_ACCOUNT_ID}/email/sending/send`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      to: message.to,
      from: { address: SENDER, name: env.NOTIFY_FROM_NAME },
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers,
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(await readLimitedBody(upstream, 64 * 1024)));
  } catch {
    // A non-JSON error still has useful HTTP semantics. No provider body is echoed.
    payload = null;
  }
  const errorCode = isRecord(payload) && Array.isArray(payload.errors) && isRecord(payload.errors[0])
    ? payload.errors[0].code : undefined;
  const knownCodes = new Set([10000, 10001, 10002, 10003, 10004, 10100, 10101, 10102, 10103, 10105, 10200, 10201, 10202, 10203]);
  const code = typeof errorCode === "number" && knownCodes.has(errorCode)
    ? `E_REST_${errorCode}` : `E_REST_HTTP_${upstream.status}`;
  if (errorCode === 10003 || [400, 401, 403, 404, 413, 422].includes(upstream.status)) return jsonError(code, 422, false);
  // Retry only what the provider did not accept: a non-2xx status or an explicit success=false.
  if (!upstream.ok || (isRecord(payload) && payload.success === false)) return jsonError(code, 503);
  const result = isRecord(payload) && isRecord(payload.result) ? payload.result : {};
  const matches = (value: unknown) => Array.isArray(value) && value.some(address =>
    typeof address === "string" && address.toLowerCase() === message.to.toLowerCase());
  if (matches(result.permanent_bounces)) return jsonError("E_RECIPIENT_BOUNCED", 422, false);
  if (matches(result.suppressed_recipients)) return jsonError("E_RECIPIENT_SUPPRESSED", 422, false);
  return accepted(result.message_id, message, "rest", matches(result.delivered) || matches(result.queued));
}

export async function handleEmailRelay(request: Request, env: EmailEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.protocol !== "http:" || url.host !== "email.internal" || url.pathname !== "/v1/send" || url.search) {
    return jsonError("E_NOT_FOUND", 404, false);
  }
  if (request.method !== "POST") return jsonError("E_RELAY_METHOD", 400, false);
  if (mediaType(request) !== "application/json" || request.headers.has("content-encoding")) return jsonError("E_RELAY_CONTENT_TYPE", 400, false);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(await readLimitedBody(request, MAX_EMAIL_BYTES)));
  } catch (error) {
    return jsonError(error instanceof BodyLimitError ? "E_RELAY_BODY_TOO_LARGE" : "E_RELAY_MALFORMED", 400, false);
  }
  if (!isRelayMessage(value)) return jsonError("E_RELAY_MALFORMED", 400, false);
  const refusal = recipientRefusal(value.to, env);
  if (refusal) return jsonError(refusal, 422, false);
  if (env.EMAIL_SENDING_ENABLED !== "true") return jsonError("E_RELAY_DISABLED", 503);
  if (env.NOTIFY_FROM !== SENDER) return jsonError("E_RELAY_CONFIG", 503);
  const headers = { "X-Keyloop-Notification-Id": value.notificationId, "Auto-Submitted": "auto-generated" };
  try {
    if (env.EMAIL_TRANSPORT === "rest") return await sendRest(value, env, headers);
    if (env.EMAIL_TRANSPORT !== "binding") return jsonError("E_RELAY_CONFIG", 503);
    const result = await env.EMAIL.send({
      to: value.to,
      from: { email: SENDER, name: env.NOTIFY_FROM_NAME },
      subject: value.subject,
      text: value.text,
      html: value.html,
      headers,
    });
    return accepted(result?.messageId, value, "binding", Boolean(result?.messageId));
  } catch (error) {
    return bindingFailure(error);
  }
}
