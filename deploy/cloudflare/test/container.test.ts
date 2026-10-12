import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { containerEnv } from "../src/container-env";
import { ApiContainer } from "../src/index";
import { FakeContainerRuntime, fakeContainerState, settle } from "./container-runtime";
import { fakeEnv, edgeRequest } from "./helpers";

describe("container startup and Secrets Store", () => {
  it("builds the Cloudflare Production env including F2 and the allowlist", async () => {
    const { env } = fakeEnv();
    const settings = await containerEnv(env);
    expect(settings).toMatchObject({
      ASPNETCORE_ENVIRONMENT: "Production", ASPNETCORE_HTTP_PORTS: "8080",
      ConnectionStrings__schedulerdb: "local-test-database-value", Database__SeedDemoData: "true",
      Database__MigrateOnStartup: "false", Demo__ReseedKey: "",
      Security__ForwardedHeaders__Enabled: "true",
      Security__ForwardedHeaders__KnownNetworks__0: "0.0.0.0/0", Security__ForwardedHeaders__KnownNetworks__1: "::/0",
      Security__RateLimiting__BookingPermitsPerMinute: "120", Notifications__Provider: "Cloudflare",
      Notifications__Relay__BaseUrl: "http://email.internal", Notifications__Recipients__Mode: "AllowList",
      Notifications__Recipients__AllowedAddresses__0: env.EMAIL_ALLOWED_ADDRESSES,
    });
    expect(settings).not.toHaveProperty("ASPNETCORE_HTTPS_PORT");
    expect(settings).not.toHaveProperty("EMAIL_API_TOKEN");
    expect(settings).not.toHaveProperty("GRAFANA_OTLP_BASIC_BROWSER");
  });
  it.each([null, "", "   "])("fails before starting with a missing DB secret", async value => {
    const { env, mocks } = fakeEnv();
    mocks.DB_URL.get.mockResolvedValue(value);
    await expect(containerEnv(env)).rejects.toThrow("Secrets Store secret keyloop_prod_db_url is unavailable");
  });
  it("sanitises a Secrets Store read exception", async () => {
    const { env, mocks } = fakeEnv();
    mocks.DB_URL.get.mockRejectedValue(new Error("local-sensitive-value"));
    await expect(containerEnv(env)).rejects.toThrow(/^Secrets Store secret keyloop_prod_db_url is unavailable$/);
  });
  it("requires an approved allowlist before enabling notifications", async () => {
    const { env } = fakeEnv();
    env.EMAIL_ALLOWED_ADDRESSES = "";
    await expect(containerEnv(env)).rejects.toThrow("approved recipient allowlist");
    env.NOTIFICATIONS_ENABLED = "false";
    expect((await containerEnv(env)).Notifications__Enabled).toBe("false");
  });
  it.each([
    ["EMAIL_ALLOWED_ADDRESSES", "reviewer@example.com"],
    ["EMAIL_ALLOWED_ADDRESSES", "reviewer@nested.test"],
    ["EMAIL_ALLOWED_DOMAINS", "example.org"],
    ["EMAIL_ALLOWED_ADDRESSES", "Name <reviewer@keyloop.kylesmile.me>"],
  ] as const)("refuses to start with %s=%s", async (name, value) => {
    const { env } = fakeEnv();
    env[name] = value;
    await expect(containerEnv(env)).rejects.toThrow("valid non-reserved notification allowlist");
  });
  it("passes operator-selected caps below the account quota to the dispatcher", async () => {
    const { env } = fakeEnv();
    env.EMAIL_MAX_PER_DAY = "40";
    env.EMAIL_MAX_PER_RECIPIENT_PER_DAY = "3";
    expect(await containerEnv(env)).toMatchObject({
      Notifications__Recipients__MaxPerDay: "40", Notifications__Recipients__MaxPerRecipientPerDay: "3",
    });
  });
  it.each(["0", "-1", "NaN", "1.5", "10001"])("refuses an invalid daily email cap %s", async cap => {
    const { env } = fakeEnv();
    env.EMAIL_MAX_PER_DAY = cap;
    await expect(containerEnv(env)).rejects.toThrow("valid daily email cap");
  });
  it("refuses a per-recipient cap outside the .NET options range", async () => {
    const { env } = fakeEnv();
    env.EMAIL_MAX_PER_RECIPIENT_PER_DAY = "1001";
    await expect(containerEnv(env)).rejects.toThrow("valid per-recipient email cap");
  });
  it("registers the email relay on the container outbound handler", async () => {
    const { env, mocks } = fakeEnv();
    const result = await ApiContainer.outboundByHost!["email.internal"]!(new Request("http://email.internal/v1/send"), env, {} as Parameters<NonNullable<typeof ApiContainer.outboundByHost>[string]>[2]);
    expect(result.status).toBe(400);
    expect(mocks.EMAIL.send).not.toHaveBeenCalled();
  });
});

// The real @cloudflare/containers class against a fake runtime: the library's own readiness and restart paths are
// what these tests observe, so a regression in how ApiContainer drives them cannot hide behind a mocked base class.
describe("container lifecycle with the real Container class", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function container(readyAfterMs: number) {
    const runtime = new FakeContainerRuntime(readyAfterMs);
    const { env, mocks } = fakeEnv();
    const api = new ApiContainer(fakeContainerState(runtime), env);
    return { runtime, api, env, mocks };
  }

  it("starts on 8080 with the Production env and email interception, and waits up to 60 s for Kestrel", async () => {
    const { runtime, api } = container(59_000);
    const first = settle(api.fetch(edgeRequest("/api/v1/dealerships")));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await first).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(api.defaultPort).toBe(8080);
    expect(api.sleepAfter).toBe("30m");
    expect(api.pingEndpoint).toBe("localhost/alive");
    expect(runtime.starts).toEqual([{
      enableInternet: true,
      env: expect.objectContaining({
        ASPNETCORE_ENVIRONMENT: "Production", ConnectionStrings__schedulerdb: "local-test-database-value",
        Security__ForwardedHeaders__Enabled: "true",
      }),
    }]);
    expect(runtime.intercepted).toEqual(["email.internal", "triage-media.internal"]);
    expect(runtime.proxied.map(request => new URL(request.url).pathname)).toEqual(["/api/v1/dealerships"]);
  });

  it("holds a request that arrives mid cold start to the same 60 s window, not the library's 20 s default", async () => {
    const { runtime, api } = container(25_000);
    const first = settle(api.fetch(edgeRequest("/api/v1/dealerships")));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runtime.running).toBe(true);
    const second = settle(api.fetch(edgeRequest("/api/v1/workshop-schedule")));
    await vi.advanceTimersByTimeAsync(23_000);
    expect(runtime.proxied).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await first).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(await second).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.starts).toHaveLength(1);
    expect(runtime.proxied).toHaveLength(2);
  });

  it("serves a healthy container without reading Secrets Store (F5)", async () => {
    const { runtime, api, mocks } = container(1_000);
    const warm = settle(api.fetch(edgeRequest("/api")));
    await vi.advanceTimersByTimeAsync(2_000);
    await warm;
    const reads = mocks.DB_URL.get.mock.calls.length;
    mocks.DB_URL.get.mockRejectedValue(new Error("Secrets Store unavailable"));
    expect((await api.fetch(edgeRequest("/api"))).status).toBe(204);
    expect(mocks.DB_URL.get).toHaveBeenCalledTimes(reads);
    expect(runtime.starts).toHaveLength(1);
  });

  it("fails the request, not with a library text response, when Kestrel never listens within 60 s", async () => {
    const { runtime, api } = container(Number.POSITIVE_INFINITY);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const first = settle(api.fetch(edgeRequest("/api")));
    await vi.advanceTimersByTimeAsync(1_000);
    const second = settle(api.fetch(edgeRequest("/api")));
    await vi.advanceTimersByTimeAsync(58_000);
    let settled = false;
    void first.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await first).toEqual({ error: expect.any(Error) });
    expect(await second).toEqual({ error: expect.any(Error) });
    expect(runtime.starts).toHaveLength(1);
    expect(runtime.proxied).toHaveLength(0);
  });

  it("restarts a stopped container with a freshly read configuration", async () => {
    const { runtime, api, mocks } = container(1_000);
    const warm = settle(api.fetch(edgeRequest("/api")));
    await vi.advanceTimersByTimeAsync(2_000);
    await warm;
    runtime.exit();
    mocks.DB_URL.get.mockResolvedValue("rotated-local-test-value");
    const next = settle(api.fetch(edgeRequest("/api")));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await next).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.starts).toHaveLength(2);
    expect(runtime.starts[1]!.env).toMatchObject({
      ConnectionStrings__schedulerdb: "rotated-local-test-value", Security__ForwardedHeaders__KnownNetworks__0: "0.0.0.0/0",
    });
  });

  it("gives a library-initiated restart the last start configuration, never an empty env", async () => {
    const { runtime, api } = container(1_000);
    const warm = settle(api.fetch(edgeRequest("/api")));
    await vi.advanceTimersByTimeAsync(2_000);
    await warm;
    // The container stops between the guard and the proxy; containerFetch then starts it on its own.
    runtime.exit();
    const proxied = settle(api.containerFetch(edgeRequest("/api"), 8080));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await proxied).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.starts[1]!.env).toMatchObject({
      ConnectionStrings__schedulerdb: "local-test-database-value", Security__ForwardedHeaders__Enabled: "true",
    });
  });

  it("never starts or proxies when the DB secret is unavailable", async () => {
    const { runtime, api, mocks } = container(1_000);
    mocks.DB_URL.get.mockResolvedValue(null);
    await expect(api.fetch(edgeRequest("/api"))).rejects.toThrow("keyloop_prod_db_url is unavailable");
    expect(runtime.starts).toHaveLength(0);
    expect(runtime.proxied).toHaveLength(0);
  });
});
