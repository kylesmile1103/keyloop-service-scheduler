import { vi } from "vitest";

// Binding fakes are confined to this test boundary. Global fetch is denied by setup.ts.
export function fakeEnv() {
  const env = {
    ASSETS: { fetch: vi.fn().mockResolvedValue(new Response("<html>SPA</html>", { headers: { "content-type": "text/html" } })), connect: vi.fn() },
    API: {
      idFromName: vi.fn().mockReturnValue("fake-api-id"),
      get: vi.fn().mockReturnValue({ fetch: vi.fn().mockResolvedValue(Response.json({ api: true })) }),
      newUniqueId: vi.fn(), idFromString: vi.fn(), getByName: vi.fn(), jurisdiction: vi.fn(),
    },
    DB_URL: { get: vi.fn().mockResolvedValue("local-test-database-value") },
    EMAIL: { send: vi.fn().mockResolvedValue({ messageId: "provider-id" }) },
    EMAIL_API_TOKEN: { get: vi.fn().mockResolvedValue("local-test-email-value") },
    GRAFANA_OTLP_BASIC_BROWSER: { get: vi.fn().mockResolvedValue("bG9jYWw6dGVzdA==") },
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
  };
  return { env: env satisfies Env, mocks: env };
}

export function edgeRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", "203.0.113.7");
  return new Request(`https://keyloop.kylesmile.me${path}`, { ...init, headers });
}
