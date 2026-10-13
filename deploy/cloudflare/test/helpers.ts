import { vi } from "vitest";

export const FAKE_API_OTLP_TOKEN = "glc_local-fake-otlp-token>ab?c";

// Binding fakes are confined to this test boundary. Global fetch is denied by setup.ts.
export function fakeEnv() {
  const env = {
    CF_VERSION_METADATA: { id: "fixture-worker-version-1", tag: "", timestamp: "" },
    ASSETS: { fetch: vi.fn().mockResolvedValue(new Response("<html>SPA</html>", { headers: { "content-type": "text/html" } })), connect: vi.fn() },
    API: {
      idFromName: vi.fn().mockReturnValue("fake-api-id"),
      get: vi.fn().mockReturnValue({ fetch: vi.fn().mockResolvedValue(Response.json({ api: true })) }),
      newUniqueId: vi.fn(), idFromString: vi.fn(), getByName: vi.fn(), jurisdiction: vi.fn(),
    },
    DB_URL: { get: vi.fn().mockResolvedValue("local-test-database-value") },
    API_IMAGE: "registry.cloudflare.com/00000000000000000000000000000000/keyloop-scheduler-api:local-test",
    AUTH_TEAM_DOMAIN: "https://local-fixture.cloudflareaccess.com",
    AUTH_AUDIENCE: "local-validation-audience",
    AUTH_ADMIN: "",
    AUTH_SERVICE_ADVISOR: "",
    AUTH_VIEWER: "",
    TRIAGE_IMAGES: { put: vi.fn(), get: vi.fn(), delete: vi.fn(), head: vi.fn(), list: vi.fn(), createMultipartUpload: vi.fn(), resumeMultipartUpload: vi.fn() },
    AI_TOKEN: { get: vi.fn().mockResolvedValue("test-token") },
    TRIAGE_ENABLED: "false" as Env["TRIAGE_ENABLED"],
    TRIAGE_ACCOUNT_ID: "00000000000000000000000000000000",
    TRIAGE_GATEWAY_ID: "keyloop-scheduler",
    VEHICLE_AWARE_REQUIREMENTS: "false" as Env["VEHICLE_AWARE_REQUIREMENTS"],
    EMAIL: { send: vi.fn().mockResolvedValue({ messageId: "provider-id" }) },
    EMAIL_API_TOKEN: { get: vi.fn().mockResolvedValue("local-test-email-value") },
    GRAFANA_OTLP_BASIC_BROWSER: { get: vi.fn().mockResolvedValue("bG9jYWw6dGVzdA==") },
    // A fake Grafana token whose base64 credential holds "+", "/" and "=" padding, so the header encoding is exercised.
    API_OTLP_TOKEN: { get: vi.fn().mockResolvedValue(FAKE_API_OTLP_TOKEN) },
    OTLP_RELAY_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    NOTIFY_FROM: "notifications@keyloop.kylesmile.me" as const,
    NOTIFY_FROM_NAME: "Keyloop Service Scheduler (demo)" as const,
    // cloudflare.config.ts validates these settings, so the generated Env narrows them to their allowed values.
    NOTIFICATIONS_ENABLED: "true" as Env["NOTIFICATIONS_ENABLED"],
    EMAIL_SENDING_ENABLED: "true" as Env["EMAIL_SENDING_ENABLED"],
    EMAIL_TRANSPORT: "binding" as Env["EMAIL_TRANSPORT"],
    EMAIL_ACCOUNT_ID: "11111111111111111111111111111111",
    EMAIL_ALLOWED_ADDRESSES: "reviewer@keyloop.kylesmile.me",
    EMAIL_ALLOWED_DOMAINS: "",
    EMAIL_MAX_PER_RECIPIENT_PER_DAY: "10",
    EMAIL_MAX_PER_DAY: "100",
    OTLP_RELAY_ENABLED: "true" as Env["OTLP_RELAY_ENABLED"],
    GRAFANA_OTLP_ENDPOINT: "https://otlp-gateway-local.grafana.net/otlp",
    API_OTLP_ENABLED: "false" as Env["API_OTLP_ENABLED"],
    GRAFANA_INSTANCE_ID: "123456",
  };
  return { env: env satisfies Env, mocks: env };
}

export function edgeRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", "203.0.113.7");
  return new Request(`https://keyloop.kylesmile.me${path}`, { ...init, headers });
}
