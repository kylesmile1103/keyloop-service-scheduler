import { BodyLimitError, jsonError, mediaType, readLimitedBody } from "./http.ts";
import { requiredSecret } from "./secrets.ts";

export const MAX_OTLP_BYTES = 256 * 1024;
type OtlpEnv = Pick<Env, "OTLP_RELAY_ENABLED" | "GRAFANA_OTLP_ENDPOINT" | "GRAFANA_OTLP_BASIC_BROWSER" | "OTLP_RELAY_LIMITER">;

/**
 * The normalised base URL when the value is exactly a Grafana Cloud OTLP gateway base URL
 * (`https://otlp-gateway-<region>.grafana.net/otlp`, no trailing slash), otherwise null. Shared with settings.ts and the
 * container start, where it becomes the API's OTEL_EXPORTER_OTLP_ENDPOINT (the SDK appends /v1/<signal>).
 */
export function grafanaOtlpBaseUrl(value: string): string | null {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    return null;
  }
  const valid = endpoint.protocol === "https:" && /^otlp-gateway-[a-z0-9-]+\.grafana\.net$/.test(endpoint.hostname) &&
    endpoint.pathname === "/otlp" && !endpoint.port && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash;
  return valid ? `${endpoint.origin}/otlp` : null;
}

/** The traces URL when the value is exactly a Grafana Cloud OTLP gateway base URL, otherwise null. Shared with settings.ts. */
export function grafanaTracesUrl(value: string): string | null {
  const base = grafanaOtlpBaseUrl(value);
  return base === null ? null : `${base}/v1/traces`;
}

export async function relayBrowserTraces(request: Request, env: OtlpEnv): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return jsonError("E_CROSS_SITE", 403);
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) return jsonError("E_CROSS_SITE", 403);
  const type = mediaType(request);
  if (type !== "application/x-protobuf" && type !== "application/json") return jsonError("E_CONTENT_TYPE", 415);
  // Refuse compression so the cap also bounds decompressed collector input.
  if (request.headers.has("content-encoding")) return jsonError("E_CONTENT_ENCODING", 415);
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) return jsonError("E_CLIENT_IP_MISSING", 400);
  try {
    const { success } = await env.OTLP_RELAY_LIMITER.limit({ key: ip });
    if (!success) return new Response(null, { status: 429, headers: { "retry-after": "60", "cache-control": "no-store" } });
    if (env.OTLP_RELAY_ENABLED !== "true") return jsonError("E_OTLP_DISABLED", 503);
    const body = await readLimitedBody(request, MAX_OTLP_BYTES);
    if (body.byteLength === 0) return jsonError("E_BODY_SIZE", 413);
    const tracesUrl = grafanaTracesUrl(env.GRAFANA_OTLP_ENDPOINT);
    if (!tracesUrl) return jsonError("E_OTLP_CONFIG", 503);
    const basic = await requiredSecret(env.GRAFANA_OTLP_BASIC_BROWSER, "grafana-otlp-basic-browser");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(basic)) return jsonError("E_OTLP_CONFIG", 503);
    const upstream = await fetch(tracesUrl, {
      method: "POST",
      headers: { "content-type": type, authorization: `Basic ${basic}` },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    await upstream.body?.cancel();
    // No upstream error text, cookies, redirects, or credentials reach the browser.
    return new Response(null, {
      status: upstream.status >= 300 && upstream.status < 400 ? 502 : upstream.status,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    return jsonError(error instanceof BodyLimitError ? "E_BODY_SIZE" : "E_OTLP_UNAVAILABLE", error instanceof BodyLimitError ? 413 : 503);
  }
}
