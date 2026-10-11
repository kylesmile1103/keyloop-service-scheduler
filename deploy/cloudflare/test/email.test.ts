import { describe, expect, it, vi } from "vitest";
import { handleEmailRelay, MAX_EMAIL_BYTES } from "../src/email/relay";
import { fakeEnv } from "./helpers";
import fixture from "./fixtures/email-relay-request.json" with { type: "json" };

const relayRequest = (message: unknown = fixture) => new Request("http://email.internal/v1/send", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(message),
});

describe("Keyloop email relay contract", () => {
  it("accepts the shared fixture, pins sender and sends only the approved headers", async () => {
    const { env, mocks } = fakeEnv();
    const response = await handleEmailRelay(relayRequest(), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ messageId: "provider-id" });
    expect(mocks.EMAIL.send).toHaveBeenCalledExactlyOnceWith({
      to: fixture.to, from: { email: "notifications@keyloop.kylesmile.me", name: env.NOTIFY_FROM_NAME },
      subject: fixture.subject, text: fixture.text, html: fixture.html,
      headers: { "X-Keyloop-Notification-Id": fixture.notificationId, "Auto-Submitted": "auto-generated" },
    });
    expect(mocks.EMAIL_API_TOKEN.get).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["E_RATE_LIMIT_EXCEEDED", "E_DAILY_LIMIT_EXCEEDED", "E_INTERNAL_SERVER_ERROR", "E_DELIVERY_FAILED", "E_NEW_PROVIDER_ERROR"])("retries %s without exposing provider text", async code => {
    const { env, mocks } = fakeEnv();
    mocks.EMAIL.send.mockRejectedValue(Object.assign(new Error("local-sensitive-value"), { code }));
    const response = await handleEmailRelay(relayRequest(), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: code === "E_NEW_PROVIDER_ERROR" ? "E_PROVIDER_UNKNOWN" : code, retryable: true });
  });
  it.each([
    "E_VALIDATION_ERROR", "E_FIELD_MISSING", "E_TOO_MANY_RECIPIENTS", "E_TOO_MANY_ATTACHMENTS",
    "E_SENDER_NOT_VERIFIED", "E_RECIPIENT_NOT_ALLOWED", "E_RECIPIENT_SUPPRESSED", "E_SENDER_DOMAIN_NOT_AVAILABLE",
    "E_CONTENT_TOO_LARGE", "E_HEADER_NOT_ALLOWED", "E_HEADER_USE_API_FIELD", "E_HEADER_VALUE_INVALID",
    "E_HEADER_VALUE_TOO_LONG", "E_HEADER_NAME_INVALID", "E_HEADERS_TOO_LARGE", "E_HEADERS_TOO_MANY",
  ])("permanently refuses %s", async code => {
    const { env, mocks } = fakeEnv();
    mocks.EMAIL.send.mockRejectedValue(Object.assign(new Error("recipient and body must stay private"), { code }));
    const response = await handleEmailRelay(relayRequest(), env);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ code, retryable: false });
  });
  it("maps timeouts, unknown exceptions and credential-shaped codes without leaking values", async () => {
    const { env, mocks } = fakeEnv();
    mocks.EMAIL.send.mockRejectedValue(Object.assign(new Error("local-sensitive-value"), { code: "credential-local-sensitive-value" }));
    expect(await (await handleEmailRelay(relayRequest(), env)).json()).toEqual({ code: "E_PROVIDER_UNKNOWN", retryable: true });
  });
  it("refuses a recipient outside the allowlist before using a transport", async () => {
    const { env, mocks } = fakeEnv();
    const response = await handleEmailRelay(relayRequest({ ...fixture, to: "unapproved@keyloop.kylesmile.me" }), env);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ code: "E_RECIPIENT_NOT_ALLOWLISTED", retryable: false });
    expect(mocks.EMAIL.send).not.toHaveBeenCalled();
  });
  it.each(["example.com", "nested.EXAMPLE.COM", "example.net", "example.org", "nested.example.org", "example", "test", "invalid", "localhost", "nested.test", "nested.invalid", "nested.localhost", "nested.example"])("always blocks %s even when explicitly allowlisted", async domain => {
    const { env, mocks } = fakeEnv();
    env.EMAIL_ALLOWED_DOMAINS = domain;
    env.EMAIL_ALLOWED_ADDRESSES = `reviewer@${domain}`;
    const response = await handleEmailRelay(relayRequest({ ...fixture, to: `reviewer@${domain}` }), env);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ code: "E_RESERVED_DOMAIN", retryable: false });
    expect(mocks.EMAIL.send).not.toHaveBeenCalled();
  });
  it("normalises the address allowlist and matches domains exactly", async () => {
    const { env } = fakeEnv();
    env.EMAIL_ALLOWED_ADDRESSES = " Reviewer@KEYLOOP.KYLESMILE.ME ";
    expect((await handleEmailRelay(relayRequest(), env)).status).toBe(200);
    env.EMAIL_ALLOWED_ADDRESSES = "";
    env.EMAIL_ALLOWED_DOMAINS = "keyloop.kylesmile.me";
    expect((await handleEmailRelay(relayRequest(), env)).status).toBe(200);
    expect((await handleEmailRelay(relayRequest({ ...fixture, to: "reviewer@child.keyloop.kylesmile.me" }), env)).status).toBe(422);
  });
  it("defaults an empty allowlist to refusal", async () => {
    const { env, mocks } = fakeEnv();
    env.EMAIL_ALLOWED_ADDRESSES = "";
    expect((await handleEmailRelay(relayRequest(), env)).status).toBe(422);
    expect(mocks.EMAIL.send).not.toHaveBeenCalled();
  });
  it.each([
    {}, null, [], { ...fixture, from: "attacker@keyloop.kylesmile.me" },
    { ...fixture, replyTo: "attacker@keyloop.kylesmile.me" }, { ...fixture, to: [fixture.to] },
    { ...fixture, to: "Name <reviewer@keyloop.kylesmile.me>" }, { ...fixture, subject: "line\r\nInjected: value" },
    { ...fixture, notificationId: "header\r\nInjected: value" }, { ...fixture, text: "" }, { ...fixture, html: "" },
  ])("malformed input is a permanent 400", async message => {
    const { env, mocks } = fakeEnv();
    const result = await handleEmailRelay(relayRequest(message), env);
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ retryable: false });
    expect(mocks.EMAIL.send).not.toHaveBeenCalled();
  });
  it("rejects invalid JSON and oversized chunked input", async () => {
    for (const body of ["{broken", "x".repeat(MAX_EMAIL_BYTES + 1)]) {
      const result = await handleEmailRelay(new Request("http://email.internal/v1/send", { method: "POST", headers: { "content-type": "application/json" }, body }), fakeEnv().env);
      expect(result.status).toBe(400);
    }
  });
  it("checks the private relay host, method and path", async () => {
    const { env, mocks } = fakeEnv();
    expect((await handleEmailRelay(new Request("https://keyloop.kylesmile.me/v1/send"), env)).status).toBe(404);
    expect((await handleEmailRelay(new Request("http://email.internal/v2/send"), env)).status).toBe(404);
    expect((await handleEmailRelay(new Request("http://email.internal/v1/send"), env)).status).toBe(400);
    expect(mocks.EMAIL.send).not.toHaveBeenCalled();
  });
  it("applies the kill switch without reading the fallback token", async () => {
    const { env, mocks } = fakeEnv();
    env.EMAIL_TRANSPORT = "rest";
    env.EMAIL_SENDING_ENABLED = "false";
    const response = await handleEmailRelay(relayRequest(), env);
    expect(await response.json()).toEqual({ code: "E_RELAY_DISABLED", retryable: true });
    expect(mocks.EMAIL_API_TOKEN.get).not.toHaveBeenCalled();
    expect(mocks.EMAIL.send).not.toHaveBeenCalled();
  });
});

describe("explicit REST fallback", () => {
  function restEnv() {
    const result = fakeEnv();
    result.env.EMAIL_TRANSPORT = "rest";
    return result;
  }
  it.each(["delivered", "queued"])("treats %s as acceptance and uses the REST field names", async field => {
    const { env, mocks } = restEnv();
    const outbound = vi.fn().mockResolvedValue(Response.json({ success: true, result: { [field]: [fixture.to], message_id: "rest-id" } }));
    vi.stubGlobal("fetch", outbound);
    const response = await handleEmailRelay(relayRequest(), env);
    expect(await response.json()).toEqual({ messageId: "rest-id" });
    const [url, init] = outbound.mock.calls[0]!;
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${env.EMAIL_ACCOUNT_ID}/email/sending/send`);
    expect(init.headers.authorization).toBe("Bearer local-test-email-value");
    expect(init.redirect).toBe("manual");
    const body = JSON.parse(init.body);
    expect(body.from).toEqual({ address: "notifications@keyloop.kylesmile.me", name: env.NOTIFY_FROM_NAME });
    expect(body.headers).not.toHaveProperty("Message-ID");
    expect(body).not.toHaveProperty("replyTo");
    expect(body).not.toHaveProperty("reply_to");
    expect(mocks.EMAIL.send).not.toHaveBeenCalled();
  });
  it("supports accepted REST results without an optional message id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true, result: { queued: [fixture.to] } })));
    expect(await (await handleEmailRelay(relayRequest(), restEnv().env)).json()).toEqual({ messageId: null });
  });
  it.each([[400, 10001], [401, 10101], [403, 10102], [403, 10105], [404, 10000], [500, 10003]])("maps permanent HTTP %s / code %s", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: false, errors: [{ code, message: "local-sensitive-value" }] }, { status })));
    const response = await handleEmailRelay(relayRequest(), restEnv().env);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ code: `E_REST_${code}`, retryable: false });
  });
  it.each([409, 429, 500, 503])("retries transient HTTP %s", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("non-JSON private body", { status })));
    const response = await handleEmailRelay(relayRequest(), restEnv().env);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: `E_REST_HTTP_${status}`, retryable: true });
  });
  it.each(["permanent_bounces", "suppressed_recipients"])("does not call %s a success", async field => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true, result: { [field]: [fixture.to], delivered: [fixture.to] } })));
    expect((await handleEmailRelay(relayRequest(), restEnv().env)).status).toBe(422);
  });
  it("refuses malformed acceptance data and redirects without retrying the binding", async () => {
    const { env, mocks } = restEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true, result: {} })));
    expect((await handleEmailRelay(relayRequest(), env)).status).toBe(503);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 307 })));
    expect((await handleEmailRelay(relayRequest(), env)).status).toBe(503);
    expect(mocks.EMAIL.send).not.toHaveBeenCalled();
  });
  it("fails safely with no REST token", async () => {
    const { env, mocks } = restEnv();
    mocks.EMAIL_API_TOKEN.get.mockRejectedValue(new Error("local-sensitive-value"));
    const response = await handleEmailRelay(relayRequest(), env);
    expect(await response.json()).toEqual({ code: "E_RELAY_SECRET_UNAVAILABLE", retryable: true });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("never switches transport automatically after an ambiguous network failure", async () => {
    const { env, mocks } = restEnv();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("local-sensitive-value")));
    const response = await handleEmailRelay(relayRequest(), env);
    expect(response.status).toBe(503);
    expect(mocks.EMAIL.send).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("local-sensitive-value");
  });
});
