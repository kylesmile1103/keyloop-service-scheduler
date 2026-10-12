import { describe, expect, it, vi } from "vitest";
import { relayBrowserTraces } from "../src/otlp";
import { edgeRequest, fakeEnv } from "./helpers";

const traces = (headers: Record<string, string> = {}, body: string | Uint8Array = "protobuf") =>
  edgeRequest("/otlp/v1/traces", { method: "POST", headers: { "content-type": "application/x-protobuf", "sec-fetch-site": "same-origin", ...headers }, body });

describe("browser OTLP relay", () => {
  it.each(["GET", "PUT", "OPTIONS"])("refuses %s", async method => {
    const result = await relayBrowserTraces(edgeRequest("/otlp/v1/traces", { method }), fakeEnv().env);
    expect(result.status).toBe(405);
    expect(result.headers.get("allow")).toBe("POST");
  });
  it.each(["same-site", "cross-site", "none"])("refuses Sec-Fetch-Site %s", async site => {
    expect((await relayBrowserTraces(traces({ "sec-fetch-site": site }), fakeEnv().env)).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("refuses an inconsistent Origin header", async () => {
    expect((await relayBrowserTraces(traces({ origin: "https://foreign.invalid" }), fakeEnv().env)).status).toBe(403);
  });
  it("permits clients without fetch metadata when their Origin is consistent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const request = edgeRequest("/otlp/v1/traces", { method: "POST",
      headers: { "content-type": "application/json", origin: "https://keyloop.kylesmile.me" }, body: "{}" });
    expect((await relayBrowserTraces(request, fakeEnv().env)).status).toBe(200);
  });
  it("requires Cloudflare's client identity before calling the limiter", async () => {
    const { env, mocks } = fakeEnv();
    const request = traces();
    request.headers.delete("cf-connecting-ip");
    expect((await relayBrowserTraces(request, env)).status).toBe(400);
    expect(mocks.OTLP_RELAY_LIMITER.limit).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["text/plain", "application/x-protobuf-evil", "application/jsonp", ""])("requires an exact media type: %s", async type => {
    expect((await relayBrowserTraces(traces({ "content-type": type }), fakeEnv().env)).status).toBe(415);
  });
  it("refuses compressed bodies so the collector cannot expand past the cap", async () => {
    expect((await relayBrowserTraces(traces({ "content-encoding": "gzip" }), fakeEnv().env)).status).toBe(415);
  });
  it("rate limits by Cloudflare client IP before reading secrets or sending telemetry", async () => {
    const { env, mocks } = fakeEnv();
    mocks.OTLP_RELAY_LIMITER.limit.mockResolvedValue({ success: false });
    const result = await relayBrowserTraces(traces(), env);
    expect(result.status).toBe(429);
    expect(mocks.OTLP_RELAY_LIMITER.limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
    expect(mocks.GRAFANA_OTLP_BASIC_BROWSER.get).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  // Literal sizes: the 256 KiB cap is part of the contract with the frontend exporter.
  it.each(["", new Uint8Array(262_145)])("refuses an empty or oversized stream", async body => {
    expect((await relayBrowserTraces(traces({}, body), fakeEnv().env)).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("checks actual bytes despite an understated Content-Length", async () => {
    expect((await relayBrowserTraces(traces({ "content-length": "1" }, new Uint8Array(262_145)), fakeEnv().env)).status).toBe(413);
  });
  it("accepts the exact size boundary and forwards every byte", async () => {
    const outbound = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", outbound);
    const body = new Uint8Array(262_144).fill(42);
    expect((await relayBrowserTraces(traces({}, body), fakeEnv().env)).status).toBe(204);
    expect(outbound.mock.calls[0]![1].body).toEqual(body);
  });
  it("returns a safe transient result after a collector connection failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("local-sensitive-upstream-detail")));
    const result = await relayBrowserTraces(traces(), fakeEnv().env);
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ code: "E_OTLP_UNAVAILABLE", retryable: true });
  });
  it.each([null, "", "   "])("reports a missing token safely", async value => {
    const { env, mocks } = fakeEnv();
    mocks.GRAFANA_OTLP_BASIC_BROWSER.get.mockResolvedValue(value);
    expect((await relayBrowserTraces(traces(), env)).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("never echoes a thrown credential-bearing message", async () => {
    const { env, mocks } = fakeEnv();
    mocks.GRAFANA_OTLP_BASIC_BROWSER.get.mockRejectedValue(new Error("local-sensitive-value"));
    expect(await (await relayBrowserTraces(traces(), env)).text()).not.toContain("local-sensitive-value");
  });
  it.each(["http://otlp-gateway-local.grafana.net/otlp", "https://foreign.invalid/otlp", "https://otlp-gateway-local.grafana.net/otlp?x=1"])("rejects collector destination %s", async endpoint => {
    const { env } = fakeEnv();
    env.GRAFANA_OTLP_ENDPOINT = endpoint;
    expect((await relayBrowserTraces(traces(), env)).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["application/x-protobuf", "application/json; charset=utf-8"])("replaces caller credentials and strips upstream content for %s", async type => {
    const { env } = fakeEnv();
    const outbound = vi.fn().mockResolvedValue(new Response("upstream-sensitive-body", { status: 200, headers: { "set-cookie": "credential", authorization: "credential" } }));
    vi.stubGlobal("fetch", outbound);
    const result = await relayBrowserTraces(traces({ "content-type": type, authorization: "forged", cookie: "forged" }), env);
    const [url, init] = outbound.mock.calls[0]!;
    expect(url).toBe("https://otlp-gateway-local.grafana.net/otlp/v1/traces");
    expect(init.headers).toEqual({ "content-type": type.split(";")[0], authorization: "Basic bG9jYWw6dGVzdA==" });
    expect(init.redirect).toBe("manual");
    expect(result.status).toBe(200);
    expect(await result.text()).toBe("");
    expect(result.headers.has("set-cookie")).toBe(false);
    expect(result.headers.has("authorization")).toBe(false);
  });
  it("refuses to follow collector redirects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 307, headers: { location: "https://foreign.invalid" } })));
    expect((await relayBrowserTraces(traces(), fakeEnv().env)).status).toBe(502);
  });
  it("stays disabled before observability setup", async () => {
    const { env } = fakeEnv();
    env.OTLP_RELAY_ENABLED = "false";
    expect((await relayBrowserTraces(traces(), env)).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
});
