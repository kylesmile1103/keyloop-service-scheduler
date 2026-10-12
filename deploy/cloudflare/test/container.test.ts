import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare, Response as MiniflareResponse } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { containerEnv, startFingerprint } from "../src/container-env";
import { ApiContainer, START_FINGERPRINT_KEY, STOP_GRACE_MS } from "../src/index";
import { routeRequest } from "../src/router";
import { FakeContainerRuntime, fakeContainerState, settle } from "./container-runtime";
import { fakeEnv, edgeRequest } from "./helpers";
import coreEnvFixture from "./fixtures/container-env-core.json" with { type: "json" };

// The core-only profile: notifications, email, triage and the OTLP relay off. The .NET integration test
// CloudflareContainerEnvTests boots the API with the committed fixture, so both sides are pinned to the same contract.
function coreEnv() {
  const { env } = fakeEnv();
  return Object.assign(env, {
    NOTIFICATIONS_ENABLED: "false" as Env["NOTIFICATIONS_ENABLED"], EMAIL_SENDING_ENABLED: "false" as Env["EMAIL_SENDING_ENABLED"],
    EMAIL_ALLOWED_ADDRESSES: "", OTLP_RELAY_ENABLED: "false" as Env["OTLP_RELAY_ENABLED"],
    TRIAGE_ENABLED: "false" as Env["TRIAGE_ENABLED"], TRIAGE_ACCOUNT_ID: "",
    AUTH_ADMIN: "admin@fixture.test", AUTH_SERVICE_ADVISOR: "advisor@fixture.test", AUTH_VIEWER: "@viewers.fixture.test",
  });
}

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
  it("selects no email provider while notifications are disabled, because the API refuses the reserved Cloudflare one", async () => {
    const settings = await containerEnv(coreEnv());
    expect(settings).toMatchObject({ Notifications__Enabled: "false", Notifications__Provider: "None" });
    expect(settings).toEqual(coreEnvFixture);
  });
  it("keeps the Cloudflare provider for enabled notifications, so that start still fails loudly until its adapter exists", async () => {
    const { env } = fakeEnv();
    expect(await containerEnv(env)).toMatchObject({ Notifications__Enabled: "true", Notifications__Provider: "Cloudflare" });
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

describe("start configuration fingerprint", () => {
  const start = { image: "registry.example/api:a", enableInternet: true, env: { B: "2", A: "1", ConnectionStrings__schedulerdb: "local-secret-value" } };
  it("is a SHA-256 hex digest that never contains the values", async () => {
    const fingerprint = startFingerprint(start);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint).not.toContain("local-secret-value");
  });
  it("ignores key order but changes with any value, secret, image or internet access", async () => {
    const base = startFingerprint(start);
    expect(startFingerprint({ ...start, env: { A: "1", ConnectionStrings__schedulerdb: "local-secret-value", B: "2" } })).toBe(base);
    for (const changed of [
      { ...start, env: { ...start.env, ConnectionStrings__schedulerdb: "rotated-secret-value" } },
      { ...start, env: { ...start.env, Triage__Enabled: "true" } },
      { ...start, image: "registry.example/api:b" },
      { ...start, enableInternet: false },
    ]) expect(startFingerprint(changed)).not.toBe(base);
  });
  it("hashes identically in workerd with nodejs_compat", async () => {
    const bundle = await build({ entryPoints: [new URL("./fingerprint-runtime-entry.ts", import.meta.url).pathname], bundle: true,
      write: false, format: "esm", platform: "browser", external: ["node:crypto"] });
    const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0]!.text,
      compatibilityDate: "2026-10-11", compatibilityFlags: ["nodejs_compat"], cf: false,
      unsafeDevRegistryPath: new URL("../build/fingerprint-dev-registry/", import.meta.url).pathname,
      outboundService: () => new MiniflareResponse("Network forbidden", { status: 503 }),
    }));
    try {
      const response = await mf.dispatchFetch("https://fingerprint.test/", { method: "POST", body: JSON.stringify(start) });
      expect(await response.text()).toBe(startFingerprint(start));
    } finally {
      await mf.dispose();
    }
  }, 30_000);
});

// A deploy replaces the Durable Object instance but keeps its storage and the running container. The platform also restarts
// a container on an image rollout with the start options it kept, so only the Durable Object can apply a new configuration.
describe("configuration changes reach a running container", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function deploy(runtime: FakeContainerRuntime, storage: Map<string, unknown>, configure: (env: Env) => void = () => {}) {
    const { env, mocks } = fakeEnv();
    configure(env);
    return { api: new ApiContainer(fakeContainerState(runtime, storage), env), env, mocks };
  }

  async function serve(api: ApiContainer, path = "/api/v1/dealerships", advanceMs = 2_000) {
    const response = settle(api.fetch(edgeRequest(path)));
    await vi.advanceTimersByTimeAsync(advanceMs);
    return response;
  }

  async function warmContainer(readyAfterMs = 1_000) {
    const runtime = new FakeContainerRuntime(readyAfterMs);
    const storage = new Map<string, unknown>();
    const first = deploy(runtime, storage);
    expect(await serve(first.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    return { runtime, storage, first };
  }

  const enableTriage = (env: Env) => { env.TRIAGE_ENABLED = "true" as Env["TRIAGE_ENABLED"]; };

  it("restarts the running container once with the new environment after a settings deploy (the live triage incident)", async () => {
    const { runtime, storage } = await warmContainer();
    expect(runtime.starts[0]!.env).toMatchObject({ Triage__Enabled: "false" });
    const next = deploy(runtime, storage, enableTriage);
    const first = settle(next.api.fetch(edgeRequest("/api/v1/dealerships")));
    await vi.advanceTimersByTimeAsync(100);
    const concurrent = settle(next.api.fetch(edgeRequest("/api/v1/features")));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await first).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(await concurrent).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.signals).toEqual([15]);
    expect(runtime.starts).toHaveLength(2);
    expect(runtime.starts[1]!.env).toMatchObject({ Triage__Enabled: "true", Triage__ApiToken: "test-token", Triage__Model: "@cf/cloudflare/clef-flash" });
    expect(runtime.proxied.map(request => new URL(request.url).pathname)).toEqual(["/api/v1/dealerships", "/api/v1/dealerships", "/api/v1/features"]);
    // Checked once per instance: later requests neither reread Secrets Store nor restart (F5).
    const reads = next.mocks.DB_URL.get.mock.calls.length;
    expect(await serve(next.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(next.mocks.DB_URL.get).toHaveBeenCalledTimes(reads);
    expect(runtime.starts).toHaveLength(2);
  });

  it("restarts a container that was started before fingerprints were recorded", async () => {
    const runtime = new FakeContainerRuntime(1_000);
    runtime.start({ enableInternet: true, env: { Triage__Enabled: "false" } });
    await vi.advanceTimersByTimeAsync(1_000);
    const storage = new Map<string, unknown>([["__CF_CONTAINER_STATE", { status: "healthy", lastChange: Date.now() }]]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const next = deploy(runtime, storage, enableTriage);
    expect(await serve(next.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.signals).toEqual([15]);
    expect(runtime.starts[1]!.env).toMatchObject({ Triage__Enabled: "true" });
    expect(log.mock.calls.map(call => String(call[0])).filter(line => line.includes("ApiContainerRestart")))
      .toEqual([JSON.stringify({ event: "ApiContainerRestart", reason: "unrecorded" })]);
  });

  it("keeps the running container through a deploy that changes nothing it is started with", async () => {
    const { runtime, storage } = await warmContainer();
    const next = deploy(runtime, storage);
    expect(await serve(next.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.signals).toEqual([]);
    expect(runtime.starts).toHaveLength(1);
    expect(next.mocks.DB_URL.get).toHaveBeenCalledTimes(1);
  });

  it("applies a rotated Secrets Store value at the first request after the next deploy, not before", async () => {
    const { runtime, storage, first } = await warmContainer();
    first.mocks.DB_URL.get.mockResolvedValue("rotated-local-test-value");
    expect(await serve(first.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.starts).toHaveLength(1);
    const next = deploy(runtime, storage, env => {
      (env.DB_URL as unknown as { get: () => Promise<string> }).get = vi.fn().mockResolvedValue("rotated-local-test-value");
    });
    expect(await serve(next.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.starts).toHaveLength(2);
    expect(runtime.starts[1]!.env).toMatchObject({ ConnectionStrings__schedulerdb: "rotated-local-test-value" });
  });

  it("restarts under the current configuration after a rollout to another image", async () => {
    const { runtime, storage } = await warmContainer();
    const next = deploy(runtime, storage, env => { env.API_IMAGE = "registry.cloudflare.com/00000000000000000000000000000000/keyloop-scheduler-api:previous"; });
    expect(await serve(next.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.signals).toEqual([15]);
    expect(runtime.starts).toHaveLength(2);
    expect(runtime.starts[1]!.env).toEqual(runtime.starts[0]!.env);
  });

  it("waits for a draining API to exit, then keeps the 60 s readiness window for the restarted one", async () => {
    const { runtime, storage } = await warmContainer();
    runtime.stopAfterMs = 10_000;
    runtime.readyAfterMs = 59_000;
    const next = deploy(runtime, storage, enableTriage);
    const response = settle(next.api.fetch(edgeRequest("/api/v1/dealerships")));
    await vi.advanceTimersByTimeAsync(9_000);
    expect(runtime.starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runtime.starts).toHaveLength(2);
    let settled = false;
    void response.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(57_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await response).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.destroys).toBe(0);
  });

  it("holds requests that arrive while the old container drains to the same single restart", async () => {
    const { runtime, storage } = await warmContainer();
    runtime.stopAfterMs = 10_000;
    const next = deploy(runtime, storage, enableTriage);
    const first = settle(next.api.fetch(edgeRequest("/api/v1/dealerships")));
    await vi.advanceTimersByTimeAsync(5_000);
    const duringDrain = settle(next.api.fetch(edgeRequest("/api/v1/features")));
    await vi.advanceTimersByTimeAsync(5_000);
    const atExit = settle(next.api.fetch(edgeRequest("/api/v1/me")));
    await vi.advanceTimersByTimeAsync(3_000);
    for (const response of [first, duringDrain, atExit]) expect(await response).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.signals).toEqual([15]);
    expect(runtime.destroys).toBe(0);
    expect(runtime.starts).toHaveLength(2);
  });

  it("never stops a restarted container again once it runs with the recorded configuration, even if it never listens", async () => {
    const { runtime, storage } = await warmContainer();
    vi.spyOn(console, "error").mockImplementation(() => {});
    runtime.readyAfterMs = Number.POSITIVE_INFINITY;
    const next = deploy(runtime, storage, enableTriage);
    const first = settle(next.api.fetch(edgeRequest("/api/v1/dealerships")));
    await vi.advanceTimersByTimeAsync(59_000);
    let settled = false;
    void first.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await first).toEqual({ error: expect.any(Error) });
    expect(runtime.starts).toHaveLength(2);
    // Its fingerprint matches, so each later request only waits for it again: no restart loop.
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await serve(next.api, "/api/v1/dealerships", 62_000)).toEqual({ error: expect.any(Error) });
    }
    // Nor does a later deploy of the same configuration stop it.
    const again = deploy(runtime, storage, enableTriage);
    expect(await serve(again.api, "/api/v1/dealerships", 62_000)).toEqual({ error: expect.any(Error) });
    expect(runtime.signals).toEqual([15]);
    expect(runtime.destroys).toBe(0);
    expect(runtime.starts).toHaveLength(2);
  });

  it("keeps the previous fingerprint when the container will not stop, so the next request tries the restart again", async () => {
    const { runtime, storage } = await warmContainer();
    const previous = storage.get(START_FINGERPRINT_KEY);
    vi.spyOn(console, "error").mockImplementation(() => {});
    runtime.ignoresSigterm = true;
    // The kill does not take effect either.
    runtime.destroy = async () => { runtime.destroys++; };
    const next = deploy(runtime, storage, enableTriage);
    const notStopped = { error: expect.objectContaining({ message: "The API container did not stop for a configuration restart" }) };
    expect(await serve(next.api, "/api/v1/dealerships", STOP_GRACE_MS + 6_000)).toEqual(notStopped);
    expect(storage.get(START_FINGERPRINT_KEY)).toBe(previous);
    // Accepting the old container under the new fingerprint would serve it with its old configuration.
    expect(await serve(next.api, "/api/v1/dealerships", STOP_GRACE_MS + 6_000)).toEqual(notStopped);
    expect(runtime.signals).toEqual([15, 15]);
    expect(runtime.destroys).toBe(2);
    expect(runtime.starts).toHaveLength(1);
    expect(runtime.proxied.map(request => new URL(request.url).pathname)).toEqual(["/api/v1/dealerships"]);
  });

  it("kills an API that ignores SIGTERM after the grace period, then starts it with the new environment", async () => {
    const { runtime, storage } = await warmContainer();
    runtime.ignoresSigterm = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const next = deploy(runtime, storage, enableTriage);
    const response = settle(next.api.fetch(edgeRequest("/api/v1/dealerships")));
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS - 1_000);
    expect(runtime.destroys).toBe(0);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await response).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.signals).toEqual([15]);
    expect(runtime.destroys).toBe(1);
    expect(runtime.starts[1]!.env).toMatchObject({ Triage__Enabled: "true" });
    expect(errors.mock.calls.map(call => String(call[0]))).toContain(JSON.stringify({ event: "ApiContainerStopTimeout" }));
  });

  it("keeps serving a healthy container when its configuration cannot be read, and checks again on the next request", async () => {
    const { runtime, storage } = await warmContainer();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const next = deploy(runtime, storage);
    next.mocks.DB_URL.get.mockRejectedValueOnce(new Error("local-sensitive-value"));
    expect(await serve(next.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(errors.mock.calls.map(call => String(call[0]))).toEqual([JSON.stringify({ event: "ApiContainerConfigUnverified" })]);
    expect(runtime.signals).toEqual([]);
    expect(await serve(next.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(next.mocks.DB_URL.get).toHaveBeenCalledTimes(2);
    expect(await serve(next.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(next.mocks.DB_URL.get).toHaveBeenCalledTimes(2);
    expect(runtime.starts).toHaveLength(1);
  });

  it("answers 503 instead of starting an empty environment when the container stops during a slow failing Secrets Store read", async () => {
    const { runtime, storage } = await warmContainer();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const next = deploy(runtime, storage);
    next.mocks.DB_URL.get.mockImplementationOnce(() => new Promise((_, reject) => {
      setTimeout(() => reject(new Error("local-sensitive-value")), 5_000);
    }));
    // Through the Worker's router, as the request arrives.
    const { env: worker } = fakeEnv();
    worker.API.get.mockReturnValue({ fetch: (request: Request) => next.api.fetch(request) });
    const response = settle(routeRequest(edgeRequest("/api/v1/dealerships"), worker));
    await vi.advanceTimersByTimeAsync(1_000);
    // The container sleeps (or its host restarts) while the read is still pending.
    runtime.exit();
    await vi.advanceTimersByTimeAsync(7_000);
    const outcome = await response;
    expect("value" in outcome && outcome.value.status).toBe(503);
    expect("value" in outcome && await outcome.value.json()).toEqual({ code: "E_API_UNAVAILABLE", retryable: true });
    expect(runtime.starts).toHaveLength(1);
    expect(runtime.proxied).toHaveLength(1);
    expect(errors.mock.calls.map(call => String(call[0]))).not.toContain(JSON.stringify({ event: "ApiContainerConfigUnverified" }));
    // The next request reads the configuration again and starts the container with all of it.
    expect(await serve(next.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.starts).toHaveLength(2);
    expect(runtime.starts[1]!.env).toEqual(runtime.starts[0]!.env);
    expect(runtime.starts[1]!.env).toMatchObject({ ConnectionStrings__schedulerdb: "local-test-database-value" });
  });

  it("stores only a digest of the start configuration and logs no values", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { runtime, storage } = await warmContainer();
    deploy(runtime, storage, env => { env.AUTH_ADMIN = "admin@fixture.test"; });
    const next = deploy(runtime, storage, env => { env.AUTH_ADMIN = "admin@fixture.test"; enableTriage(env); });
    expect(await serve(next.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(storage.get(START_FINGERPRINT_KEY)).toMatch(/^[0-9a-f]{64}$/);
    const persisted = JSON.stringify([...storage.entries()]);
    const logged = JSON.stringify(log.mock.calls);
    for (const value of ["local-test-database-value", "test-token", "admin@fixture.test", "reviewer@keyloop.kylesmile.me"]) {
      expect(persisted).not.toContain(value);
      expect(logged).not.toContain(value);
    }
  });
});
