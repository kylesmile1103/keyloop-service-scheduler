import { describe, expect, it, vi } from "vitest";
import { routeRequest } from "../src/router";
import { edgeRequest, fakeEnv } from "./helpers";

describe("API routing and ADR-024", () => {
  it.each([200, 503, 500, 429, 302])("returns only schema readiness status for health HTTP %s", async status => {
    const { env, mocks } = fakeEnv();
    mocks.API.get().fetch.mockResolvedValue(new Response("private database/migration diagnostic", {
      status, headers: { "x-internal-diagnostic": "private", "content-type": "text/plain" },
    }));
    const result = await routeRequest(edgeRequest("/api/ready?path=/api/v1/dealerships"), env);
    expect(result.status).toBe(status === 200 ? 200 : 503);
    expect(await result.text()).toBe("");
    expect([...result.headers]).toEqual([["cache-control", "no-store"]]);
    const upstream: Request = mocks.API.get().fetch.mock.calls[0]![0];
    expect(new URL(upstream.url).pathname).toBe("/health");
    expect(new URL(upstream.url).search).toBe("");
    expect(upstream.method).toBe("GET");
    expect(mocks.API.get().fetch).toHaveBeenCalledTimes(1);
    expect(mocks.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("allows anonymous HEAD readiness and rejects writes before contacting the container", async () => {
    const { env, mocks } = fakeEnv();
    const head = await routeRequest(edgeRequest("/api/ready", { method: "HEAD" }), env);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const upstream: Request = mocks.API.get().fetch.mock.calls[0]![0];
    expect(upstream.headers.has("cookie")).toBe(false);
    expect(upstream.headers.has("cf-access-jwt-assertion")).toBe(false);
    mocks.API.get.mockClear();
    const write = await routeRequest(edgeRequest("/api/ready", { method: "POST", body: "private" }), env);
    expect(write.status).toBe(405);
    expect(write.headers.get("allow")).toBe("GET, HEAD");
    expect(mocks.API.get).not.toHaveBeenCalled();
  });

  it("returns bare unavailable readiness when the container cannot be reached", async () => {
    const { env, mocks } = fakeEnv();
    mocks.API.get().fetch.mockRejectedValue(new Error("private connection details"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await routeRequest(edgeRequest("/api/ready"), env);
    expect(result.status).toBe(503);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.text()).toBe("");
  });

  it.each(["/api", "/api/", "/api/v1/dealerships", "/api/v1/missing?x=1"])("forwards %s including navigations with a WEUR hint", async path => {
    const { env, mocks } = fakeEnv();
    const request = edgeRequest(path, { headers: { "sec-fetch-mode": "navigate" } });
    const result = await routeRequest(request, env);
    expect(await result.json()).toEqual({ api: true });
    expect(mocks.API.idFromName).toHaveBeenCalledWith("api");
    expect(mocks.API.get).toHaveBeenCalledWith("fake-api-id", { locationHint: "weur" });
    expect(mocks.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it.each(["/", "/board/deep/link", "/apix", "/alive", "/health", "/openapi/v1.json", "/scalar/v1", "/v1/send"])("serves %s through assets without container ingress", async path => {
    const { env, mocks } = fakeEnv();
    const request = edgeRequest(path);
    expect((await routeRequest(request, env)).headers.get("content-type")).toBe("text/html");
    expect(mocks.ASSETS.fetch).toHaveBeenCalledWith(request);
    expect(mocks.API.get).not.toHaveBeenCalled();
    expect(mocks.EMAIL.send).not.toHaveBeenCalled();
  });

  it.each(["/otlp", "/otlp/v1/metrics", "/otlp/v1/logs", "/otlp/v1/traces/"])("rejects unsupported telemetry route %s without SPA fallback", async path => {
    const { env, mocks } = fakeEnv();
    expect((await routeRequest(edgeRequest(path), env)).status).toBe(404);
    expect(mocks.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("overwrites forwarding headers and preserves the API body, query, correlation and response", async () => {
    const { env, mocks } = fakeEnv();
    const proxy = mocks.API.get().fetch;
    const response = Response.json({ id: "appointment" }, { status: 201, headers: { location: "/api/v1/appointments/one", "cache-control": "no-store" } });
    proxy.mockResolvedValue(response);
    const request = edgeRequest("/api/v1/book?date=2026-10-13", {
      method: "POST", body: "booking", headers: {
        "x-forwarded-for": "198.51.100.2, 198.51.100.3", "x-forwarded-proto": "http",
        forwarded: "for=forged;proto=http", "x-forwarded-host": "forged.invalid",
        traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
        "idempotency-key": "one", "x-request-id": "request-one",
      },
    });
    expect(await routeRequest(request, env)).toBe(response);
    const forwarded: Request = proxy.mock.calls[0]![0];
    expect(forwarded.headers.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(forwarded.headers.get("x-forwarded-proto")).toBe("https");
    expect(forwarded.headers.has("forwarded")).toBe(false);
    expect(forwarded.headers.has("x-forwarded-host")).toBe(false);
    expect(forwarded.headers.get("traceparent")).toBe(request.headers.get("traceparent"));
    expect(forwarded.headers.get("idempotency-key")).toBe("one");
    expect(forwarded.headers.get("x-request-id")).toBe("request-one");
    expect(forwarded.url).toBe(request.url);
    expect(forwarded.method).toBe("POST");
    expect(await forwarded.text()).toBe("booking");
  });

  it("uses the actual HTTP scheme without trusting a supplied HTTPS hint", async () => {
    const { env, mocks } = fakeEnv();
    await routeRequest(new Request("http://keyloop.kylesmile.me/api", { headers: { "cf-connecting-ip": "2001:db8::7", "x-forwarded-proto": "https" } }), env);
    const forwarded: Request = mocks.API.get().fetch.mock.calls[0]![0];
    expect(forwarded.headers.get("x-forwarded-proto")).toBe("http");
    expect(forwarded.headers.get("x-forwarded-for")).toBe("2001:db8::7");
  });

  it("fails closed without Cloudflare's single client address", async () => {
    const { env, mocks } = fakeEnv();
    expect((await routeRequest(new Request("https://keyloop.kylesmile.me/api"), env)).status).toBe(400);
    expect(mocks.API.get).not.toHaveBeenCalled();
  });

  it("reports startup failures without secrets or HTML fallback", async () => {
    const { env, mocks } = fakeEnv();
    mocks.API.get().fetch.mockRejectedValue(new Error("local-sensitive-value"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await routeRequest(edgeRequest("/api"), env);
    expect(result.status).toBe(503);
    expect(result.headers.get("content-type")).toBe("application/problem+json");
    expect(result.headers.get("retry-after")).toBe("3");
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(mocks.API.get().fetch).toHaveBeenCalledTimes(2);
    expect(await result.text()).not.toContain("local-sensitive-value");
    expect(log.mock.calls.flat().join()).not.toContain("local-sensitive-value");
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "ApiUnavailable" })]]);
    expect(mocks.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("does not retry a write when the Durable Object binding throws", async () => {
    const { env, mocks } = fakeEnv();
    mocks.API.get().fetch.mockRejectedValue(new Error("rollout exit"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const requestId = "01234567-89ab-cdef-0123-456789abcdef";
    const response = await routeRequest(edgeRequest("/api/v1/appointments", {
      method: "POST", body: "private write", headers: { "idempotency-key": "one", "x-request-id": requestId },
    }), env);
    expect(response.status).toBe(503);
    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(await response.json()).toMatchObject({ traceId: requestId, instance: "/api/v1/appointments" });
    expect(mocks.API.get().fetch).toHaveBeenCalledTimes(1);
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "ApiUnavailable" })]]);
  });

  it("passes through an API 500 without changing its body or headers", async () => {
    const { env, mocks } = fakeEnv();
    const response = Response.json({ type: "https://api.keyloop.example/problems/internal-error", status: 500 }, {
      status: 500, headers: { "content-type": "application/problem+json", "x-request-id": "api-generated" },
    });
    mocks.API.get().fetch.mockResolvedValue(response);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await routeRequest(edgeRequest("/api/v1/dealerships"), env)).toBe(response);
    expect(mocks.API.get().fetch).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });
});
