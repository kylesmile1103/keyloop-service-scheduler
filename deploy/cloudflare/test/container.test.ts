import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare, Response as MiniflareResponse } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { containerEnv, startFingerprint } from "../src/container-env";
import { ApiContainer, START_FINGERPRINT_KEY, STOP_GRACE_MS } from "../src/index";
import { routeRequest } from "../src/router";
import { FakeContainerRuntime, fakeContainerState, settle } from "./container-runtime";
import { FAKE_API_OTLP_TOKEN, fakeEnv, edgeRequest } from "./helpers";
import coreEnvFixture from "./fixtures/container-env-core.json" with { type: "json" };
import otlpEnvFixture from "./fixtures/container-env-otlp.json" with { type: "json" };
import vehicleAwareEnvFixture from "./fixtures/container-env-vehicle-aware.json" with { type: "json" };

// The core-only profile: notifications, email, triage, the OTLP relay, API telemetry and vehicle-aware requirements off.
// The .NET integration test CloudflareContainerEnvTests boots the API with the committed fixture, so both sides are
// pinned to the same contract.
function coreEnv() {
  const { env } = fakeEnv();
  return Object.assign(env, {
    NOTIFICATIONS_ENABLED: "false" as Env["NOTIFICATIONS_ENABLED"], EMAIL_SENDING_ENABLED: "false" as Env["EMAIL_SENDING_ENABLED"],
    EMAIL_ALLOWED_ADDRESSES: "", OTLP_RELAY_ENABLED: "false" as Env["OTLP_RELAY_ENABLED"],
    TRIAGE_ENABLED: "false" as Env["TRIAGE_ENABLED"], TRIAGE_ACCOUNT_ID: "",
    AUTH_ADMIN: "admin@fixture.test", AUTH_SERVICE_ADVISOR: "advisor@fixture.test", AUTH_VIEWER: "@viewers.fixture.test",
    API_OTLP_ENABLED: "false" as Env["API_OTLP_ENABLED"],
    VEHICLE_AWARE_REQUIREMENTS: "false" as Env["VEHICLE_AWARE_REQUIREMENTS"],
  });
}

// The core profile with API telemetry export on (test/fixtures/container-env-otlp.json, which CloudflareContainerEnvTests boots).
function otlpEnv() {
  return Object.assign(coreEnv(), { API_OTLP_ENABLED: "true" as Env["API_OTLP_ENABLED"] });
}

// The core profile with ADR-029's vehicle-aware requirements switched on for the deployment (test/fixtures/container-env-vehicle-aware.json).
function vehicleAwareEnv() {
  return Object.assign(coreEnv(), { VEHICLE_AWARE_REQUIREMENTS: "true" as Env["VEHICLE_AWARE_REQUIREMENTS"] });
}

// Both on: API telemetry export and the vehicle-aware switch.
function otlpAndVehicleAwareEnv() {
  return Object.assign(otlpEnv(), { VEHICLE_AWARE_REQUIREMENTS: "true" as Env["VEHICLE_AWARE_REQUIREMENTS"] });
}

const otlpKeys = (settings: Record<string, string>) => Object.keys(settings).filter(key => key.startsWith("OTEL_"));
const schedulingKeys = (settings: Record<string, string>) => Object.keys(settings).filter(key => key.startsWith("Scheduling__"));

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
  it("passes nothing OTLP-related while API telemetry is disabled, even with its identifiers configured", async () => {
    const env = coreEnv();
    expect(env.GRAFANA_OTLP_ENDPOINT).not.toBe("");
    expect(env.GRAFANA_INSTANCE_ID).not.toBe("");
    const settings = await containerEnv(env);
    expect(otlpKeys(settings)).toEqual([]);
    expect(otlpKeys(coreEnvFixture)).toEqual([]);
    expect(env.API_OTLP_TOKEN.get).not.toHaveBeenCalled();
  });
  it("exports API telemetry to the Grafana gateway under the dashboards' job and environment", async () => {
    const env = otlpEnv();
    const settings = await containerEnv(env);
    expect(settings).toEqual(otlpEnvFixture);
    expect(settings).toMatchObject({
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://otlp-gateway-local.grafana.net/otlp",
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
      // job="keyloop-scheduler/api" is service.namespace/service.name; deployment.environment.name comes from the API's
      // ASPNETCORE_ENVIRONMENT (ServiceDefaults), so the dashboards' Production default selects this deployment.
      OTEL_SERVICE_NAME: "api",
      OTEL_RESOURCE_ATTRIBUTES: "service.namespace=keyloop-scheduler",
      ASPNETCORE_ENVIRONMENT: "Production",
    });
    // OTEL headers are W3C-baggage style: the space is percent-encoded; base64's "+", "/" and "=" are legal value octets.
    const prefix = "Authorization=Basic%20";
    expect(settings.OTEL_EXPORTER_OTLP_HEADERS?.startsWith(prefix)).toBe(true);
    const credential = settings.OTEL_EXPORTER_OTLP_HEADERS!.slice(prefix.length);
    expect(credential).toMatch(/\+.*\/.*==$/);
    expect(atob(credential)).toBe(`123456:${FAKE_API_OTLP_TOKEN}`);
    expect(env.API_OTLP_TOKEN.get).toHaveBeenCalledTimes(1);
    // Telemetry adds only the OTEL variables to the core profile.
    const withoutOtlp = Object.fromEntries(Object.entries(otlpEnvFixture).filter(([key]) => !key.startsWith("OTEL_")));
    expect(withoutOtlp).toEqual(coreEnvFixture);
  });
  it("normalises the gateway endpoint it passes on", async () => {
    const env = otlpEnv();
    env.GRAFANA_OTLP_ENDPOINT = "https://OTLP-GATEWAY-prod-eu-west-2.grafana.net/otlp";
    expect((await containerEnv(env)).OTEL_EXPORTER_OTLP_ENDPOINT).toBe("https://otlp-gateway-prod-eu-west-2.grafana.net/otlp");
  });
  it.each([
    ["GRAFANA_OTLP_ENDPOINT", "", "KEYLOOP_GRAFANA_OTLP_ENDPOINT"],
    ["GRAFANA_OTLP_ENDPOINT", "https://otlp-gateway-local.grafana.net/otlp/", "KEYLOOP_GRAFANA_OTLP_ENDPOINT"],
    ["GRAFANA_OTLP_ENDPOINT", "https://collector.example.com/otlp", "KEYLOOP_GRAFANA_OTLP_ENDPOINT"],
    ["GRAFANA_INSTANCE_ID", "", "KEYLOOP_GRAFANA_INSTANCE_ID"],
    ["GRAFANA_INSTANCE_ID", "stack-1", "KEYLOOP_GRAFANA_INSTANCE_ID"],
  ] as const)("refuses to start API telemetry with %s=%j before reading its token", async (name, value, message) => {
    const env = otlpEnv();
    env[name] = value;
    await expect(containerEnv(env)).rejects.toThrow(message);
    expect(env.API_OTLP_TOKEN.get).not.toHaveBeenCalled();
  });
  it.each([null, "", "   "])("fails before starting with a missing API telemetry token (%j)", async value => {
    const env = otlpEnv();
    env.API_OTLP_TOKEN.get.mockResolvedValue(value);
    await expect(containerEnv(env)).rejects.toThrow(/^Secrets Store secret keyloop_prod_api_otlp_token is unavailable$/);
  });
  it("sanitises an API telemetry token read exception", async () => {
    const env = otlpEnv();
    env.API_OTLP_TOKEN.get.mockRejectedValue(new Error(`provider said ${FAKE_API_OTLP_TOKEN}`));
    const error = await containerEnv(env).catch((caught: unknown) => caught as Error);
    expect(error.message).toBe("Secrets Store secret keyloop_prod_api_otlp_token is unavailable");
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(FAKE_API_OTLP_TOKEN);
  });
  it.each([`${FAKE_API_OTLP_TOKEN}\n`, `glc_two parts`, "glc_\u00e9t\u00e9"])("refuses a token that is not one printable ASCII word, without echoing it", async token => {
    const env = otlpEnv();
    env.API_OTLP_TOKEN.get.mockResolvedValue(token);
    const error = await containerEnv(env).catch((caught: unknown) => caught as Error);
    expect(error.message).toBe("Secrets Store secret keyloop_prod_api_otlp_token must hold only the Grafana token, without spaces or line breaks");
    expect(error.message).not.toContain(token.trim());
  });
  it("passes no Scheduling setting while vehicle-aware requirements are off, so the API's Production default (false) applies", async () => {
    expect(schedulingKeys(await containerEnv(coreEnv()))).toEqual([]);
    expect(schedulingKeys(coreEnvFixture)).toEqual([]);
  });
  it("passes Scheduling__VehicleAwareRequirements=true, and nothing else new, when the deployment switches it on", async () => {
    const settings = await containerEnv(vehicleAwareEnv());
    expect(settings).toEqual(vehicleAwareEnvFixture);
    expect(schedulingKeys(settings)).toEqual(["Scheduling__VehicleAwareRequirements"]);
    expect(settings.Scheduling__VehicleAwareRequirements).toBe("true");
    const { Scheduling__VehicleAwareRequirements: _switch, ...rest } = vehicleAwareEnvFixture;
    expect(rest).toEqual(coreEnvFixture);
  });
  it("passes the OTLP block and the vehicle-aware switch together, each unchanged by the other", async () => {
    const settings = await containerEnv(otlpAndVehicleAwareEnv());
    expect(settings).toEqual({ ...otlpEnvFixture, Scheduling__VehicleAwareRequirements: "true" });
    expect(Object.fromEntries(Object.entries(settings).filter(([key]) => !key.startsWith("OTEL_")))).toEqual(vehicleAwareEnvFixture);
  });
  it.each(["TRUE", "yes", ""])("refuses to start with the vehicle-aware switch %j before reading Secrets Store", async value => {
    const env = coreEnv();
    env.VEHICLE_AWARE_REQUIREMENTS = value as Env["VEHICLE_AWARE_REQUIREMENTS"];
    await expect(containerEnv(env)).rejects.toThrow("Set KEYLOOP_VEHICLE_AWARE_REQUIREMENTS to true or false");
    expect(env.DB_URL.get).not.toHaveBeenCalled();
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

  it("reads the API telemetry token only at container start, like the database secret (F5)", async () => {
    const runtime = new FakeContainerRuntime(1_000);
    const env = otlpEnv();
    const api = new ApiContainer(fakeContainerState(runtime), env);
    const warm = settle(api.fetch(edgeRequest("/api")));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await warm).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.starts[0]!.env).toMatchObject({
      OTEL_EXPORTER_OTLP_HEADERS: otlpEnvFixture.OTEL_EXPORTER_OTLP_HEADERS, OTEL_SERVICE_NAME: "api",
    });
    env.API_OTLP_TOKEN.get.mockRejectedValue(new Error("Secrets Store unavailable"));
    const response = await api.fetch(edgeRequest("/api"));
    expect(response.status).toBe(204);
    expect(env.API_OTLP_TOKEN.get).toHaveBeenCalledTimes(1);
    expect(runtime.starts).toHaveLength(1);
    expect(runtime.proxied.every(request => !request.headers.has("authorization"))).toBe(true);
  });

  it("never starts the container, and keeps the token out of the failure, when the telemetry token is unusable", async () => {
    const runtime = new FakeContainerRuntime(1_000);
    const env = otlpEnv();
    env.API_OTLP_TOKEN.get.mockResolvedValue(`${FAKE_API_OTLP_TOKEN} trailing`);
    const api = new ApiContainer(fakeContainerState(runtime), env);
    const outcome = await settle(api.fetch(edgeRequest("/api")));
    const error = "error" in outcome ? outcome.error as Error : undefined;
    expect(error?.message).toContain("keyloop_prod_api_otlp_token");
    expect(error?.message).not.toContain(FAKE_API_OTLP_TOKEN);
    expect(runtime.starts).toHaveLength(0);
    expect(runtime.proxied).toHaveLength(0);
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
  it("differs for each combination of the OTLP block and the vehicle-aware switch", async () => {
    const image = "registry.example/api:a";
    const fingerprints = await Promise.all([coreEnv(), otlpEnv(), vehicleAwareEnv(), otlpAndVehicleAwareEnv()]
      .map(async env => startFingerprint({ image, enableInternet: true, env: await containerEnv(env) })));
    expect(new Set(fingerprints).size).toBe(4);
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

// A deploy can replace or retain the Durable Object instance, keeping its storage and the running container. The platform also restarts
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

  it("reconciles a settings deploy on a surviving instance once, coalescing requests", async () => {
    const { runtime, first } = await warmContainer();
    runtime.stopAfterMs = 5_000;
    enableTriage(first.env);
    first.env.CF_VERSION_METADATA.id = "fixture-worker-version-2";
    const one = settle(first.api.fetch(edgeRequest("/api/v1/features")));
    await vi.advanceTimersByTimeAsync(100);
    const two = settle(first.api.fetch(edgeRequest("/api/v1/dealerships")));
    await vi.advanceTimersByTimeAsync(7_000);
    for (const response of [one, two]) expect(await response).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.signals).toEqual([15]);
    expect(runtime.starts).toHaveLength(2);
    expect(runtime.starts[1]!.env).toMatchObject({ Triage__Enabled: "true" });
    expect(first.mocks.DB_URL.get).toHaveBeenCalledTimes(2);
    expect(await serve(first.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(first.mocks.DB_URL.get).toHaveBeenCalledTimes(2);
    expect(runtime.starts).toHaveLength(2);
  });

  it("checks a new Worker version on the same instance without restarting unchanged configuration", async () => {
    const { runtime, first } = await warmContainer();
    first.env.CF_VERSION_METADATA.id = "fixture-worker-version-2";
    expect(await serve(first.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(await serve(first.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(first.mocks.DB_URL.get).toHaveBeenCalledTimes(2);
    expect(runtime.signals).toEqual([]);
    expect(runtime.starts).toHaveLength(1);
  });

  it("picks up a rotated secret on a surviving instance only after its Worker version changes", async () => {
    const { runtime, first } = await warmContainer();
    first.mocks.DB_URL.get.mockResolvedValue("rotated-local-test-value");
    expect(await serve(first.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.starts).toHaveLength(1);
    first.env.CF_VERSION_METADATA.id = "fixture-worker-version-2";
    expect(await serve(first.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.starts[1]!.env).toMatchObject({ ConnectionStrings__schedulerdb: "rotated-local-test-value" });
  });

  it("retries an unverified new Worker version without accepting it as checked", async () => {
    const { runtime, first } = await warmContainer();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    first.env.CF_VERSION_METADATA.id = "fixture-worker-version-2";
    enableTriage(first.env);
    first.mocks.DB_URL.get.mockRejectedValueOnce(new Error("local-sensitive-value"));
    expect(await serve(first.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.starts).toHaveLength(1);
    expect(await serve(first.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.starts[1]!.env).toMatchObject({ Triage__Enabled: "true" });
    expect(first.mocks.DB_URL.get).toHaveBeenCalledTimes(3);
    expect(errors.mock.calls.map(call => String(call[0]))).toEqual([JSON.stringify({ event: "ApiContainerConfigUnverified" })]);
  });

  it("keeps a failed version restart bounded and retries it with the previous fingerprint", async () => {
    const { runtime, storage, first } = await warmContainer();
    const previous = storage.get(START_FINGERPRINT_KEY);
    vi.spyOn(console, "error").mockImplementation(() => {});
    runtime.ignoresSigterm = true;
    runtime.destroy = async () => { runtime.destroys++; };
    first.env.CF_VERSION_METADATA.id = "fixture-worker-version-2";
    enableTriage(first.env);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await serve(first.api, "/api", STOP_GRACE_MS + 6_000)).toEqual({
        error: expect.objectContaining({ message: "The API container did not stop for a configuration restart" }),
      });
      expect(storage.get(START_FINGERPRINT_KEY)).toBe(previous);
    }
    expect(runtime.starts).toHaveLength(1);
    expect(runtime.signals).toEqual([15, 15]);
  });

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

  it("restarts the container with the vehicle-aware switch when a deploy turns it on, and without it when one turns it off", async () => {
    const { runtime, storage } = await warmContainer();
    expect(runtime.starts[0]!.env).not.toHaveProperty("Scheduling__VehicleAwareRequirements");
    const on = deploy(runtime, storage, env => { env.VEHICLE_AWARE_REQUIREMENTS = "true" as Env["VEHICLE_AWARE_REQUIREMENTS"]; });
    expect(await serve(on.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.starts[1]!.env).toEqual({ ...runtime.starts[0]!.env, Scheduling__VehicleAwareRequirements: "true" });
    const off = deploy(runtime, storage);
    expect(await serve(off.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.starts[2]!.env).toEqual(runtime.starts[0]!.env);
    expect(runtime.signals).toEqual([15, 15]);
  });

  it("restarts the container when a deploy turns API telemetry on or off, keeping the vehicle-aware switch", async () => {
    const { runtime, storage } = await warmContainer();
    const vehicleAware = (env: Env) => { env.VEHICLE_AWARE_REQUIREMENTS = "true" as Env["VEHICLE_AWARE_REQUIREMENTS"]; };
    const both = deploy(runtime, storage, env => { vehicleAware(env); env.API_OTLP_ENABLED = "true" as Env["API_OTLP_ENABLED"]; });
    expect(await serve(both.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(runtime.starts[1]!.env).toMatchObject({
      Scheduling__VehicleAwareRequirements: "true", OTEL_SERVICE_NAME: "api",
      OTEL_EXPORTER_OTLP_HEADERS: otlpEnvFixture.OTEL_EXPORTER_OTLP_HEADERS,
    });
    const telemetryOff = deploy(runtime, storage, vehicleAware);
    expect(await serve(telemetryOff.api)).toEqual({ value: expect.objectContaining({ status: 204 }) });
    expect(otlpKeys(runtime.starts[2]!.env!)).toEqual([]);
    expect(runtime.starts[2]!.env).toMatchObject({ Scheduling__VehicleAwareRequirements: "true" });
    expect(runtime.signals).toEqual([15, 15]);
    expect(runtime.starts).toHaveLength(3);
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
