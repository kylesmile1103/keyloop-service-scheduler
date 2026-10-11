import { describe, expect, it, vi } from "vitest";
import { containerEnv } from "../src/container-env";
import { fakeEnv, edgeRequest } from "./helpers";

vi.mock("@cloudflare/containers", () => ({
  Container: class {
    constructor(public ctx: { container: { running: boolean } }, public env: Env) {}
    startAndWaitForPorts = vi.fn(async () => { this.ctx.container.running = true; });
    containerFetch = vi.fn(async () => Response.json({ api: true }));
  },
  ContainerProxy: class {},
}));
import { ApiContainer } from "../src/index";

describe("container startup and Secrets Store", () => {
  it("builds the Cloudflare Production env including F2 and the allowlist", async () => {
    const { env } = fakeEnv();
    const settings = await containerEnv(env);
    expect(settings).toMatchObject({
      ASPNETCORE_ENVIRONMENT: "Production", ASPNETCORE_HTTP_PORTS: "8080",
      ConnectionStrings__schedulerdb: "local-test-database-value", Database__SeedDemoData: "true",
      Database__MigrateOnStartup: "false", Demo__ReseedKey: "",
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
  it("starts on 8080 with a 60-second readiness window and sleeps after 30 minutes", async () => {
    const { env, mocks } = fakeEnv();
    const ctx = { container: { running: false } };
    const api = new ApiContainer(ctx as DurableObjectState<{}>, env);
    await api.fetch(edgeRequest("/api"));
    expect(api.defaultPort).toBe(8080);
    expect(api.sleepAfter).toBe("30m");
    expect(api.enableInternet).toBe(true);
    expect(api.pingEndpoint).toBe("localhost/alive");
    expect(api.startAndWaitForPorts).toHaveBeenCalledWith(expect.objectContaining({
      ports: [8080], cancellationOptions: { portReadyTimeoutMS: 60_000 },
      startOptions: { envVars: expect.objectContaining({ ConnectionStrings__schedulerdb: "local-test-database-value" }) },
    }));
    await api.fetch(edgeRequest("/api"));
    expect(mocks.DB_URL.get).toHaveBeenCalledTimes(1);
    expect(api.startAndWaitForPorts).toHaveBeenCalledTimes(1);
    expect(api.containerFetch).toHaveBeenCalledTimes(2);
  });
  it("reads a rotated DB value only on the next start", async () => {
    const { env, mocks } = fakeEnv();
    const ctx = { container: { running: false } };
    const api = new ApiContainer(ctx as DurableObjectState<{}>, env);
    await api.fetch(edgeRequest("/api"));
    ctx.container.running = false;
    mocks.DB_URL.get.mockResolvedValue("rotated-local-test-value");
    await api.fetch(edgeRequest("/api"));
    expect(api.startAndWaitForPorts).toHaveBeenLastCalledWith(expect.objectContaining({
      startOptions: { envVars: expect.objectContaining({ ConnectionStrings__schedulerdb: "rotated-local-test-value" }) },
    }));
  });
  it("never starts or proxies when the DB secret is unavailable", async () => {
    const { env, mocks } = fakeEnv();
    mocks.DB_URL.get.mockResolvedValue(null);
    const api = new ApiContainer({ container: { running: false } } as DurableObjectState<{}>, env);
    await expect(api.fetch(edgeRequest("/api"))).rejects.toThrow("keyloop_prod_db_url is unavailable");
    expect(api.startAndWaitForPorts).not.toHaveBeenCalled();
    expect(api.containerFetch).not.toHaveBeenCalled();
  });
  it("registers the email relay on the container outbound handler", async () => {
    const { env, mocks } = fakeEnv();
    const result = await ApiContainer.outboundByHost!["email.internal"]!(new Request("http://email.internal/v1/send"), env, {} as Parameters<NonNullable<typeof ApiContainer.outboundByHost>[string]>[2]);
    expect(result.status).toBe(400);
    expect(mocks.EMAIL.send).not.toHaveBeenCalled();
  });
});
