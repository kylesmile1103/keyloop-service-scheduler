import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiContainer } from "../src/index";
import { routeRequest } from "../src/router";
import { FakeContainerRuntime, fakeContainerState, settle } from "./container-runtime";
import { edgeRequest, fakeEnv } from "./helpers";

const type = "https://api.keyloop.example/problems/service-unavailable";
const failures = [
  "Runtime signalled the container to exit due to a new version rollout: 0",
  "The container is not listening on port 8080",
  "connect ECONNREFUSED",
  "Network connection lost. ECONNRESET",
];

describe("container transport unavailability", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IdentityTransformStream", TransformStream);
  });
  afterEach(() => { vi.useRealTimers(); });

  async function warm() {
    const { env } = fakeEnv();
    const runtime = new FakeContainerRuntime(0);
    const api = new ApiContainer(fakeContainerState(runtime), env);
    expect((await api.fetch(edgeRequest("/api/v1/dealerships"))).status).toBe(204);
    // Fail at the native port fetch, below the SDK's text-500 conversion.
    const fetch = vi.fn<(...args: unknown[]) => Promise<Response>>();
    vi.spyOn(runtime, "getTcpPort").mockReturnValue({ fetch } as ReturnType<typeof runtime.getTcpPort>);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    return { api, fetch, log, runtime };
  }

  async function expectUnavailable(response: Response, method: string) {
    expect(response.status).toBe(503);
    expect(response.statusText).toBe("Service Unavailable");
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(response.headers.get("retry-after")).toBe("3");
    expect(response.headers.get("cache-control")).toBe("no-store");
    if (method === "HEAD") {
      expect(await response.text()).toBe("");
    } else {
      expect(await response.json()).toMatchObject({
        type, title: "Service unavailable", status: 503,
        detail: "The scheduler is temporarily unavailable. Please try again in a moment.",
        instance: "/api/v1/dealerships", traceId: expect.any(String),
      });
    }
  }

  it.each(failures)("retries a GET once after a bounded delay for %s, then returns a safe problem", async failure => {
    const { api, fetch, log } = await warm();
    fetch.mockRejectedValue(new Error(`${failure}: private body, email and credentials`));
    const response = settle(api.fetch(edgeRequest("/api/v1/dealerships?private=query")));
    await vi.advanceTimersByTimeAsync(149);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await response;
    expect("value" in outcome).toBe(true);
    if ("value" in outcome) await expectUnavailable(outcome.value, "GET");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "ApiUnavailable" })]]);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"].flatMap(method => failures.map(failure => [method, failure])))
  ("never retries %s for %s, even with an idempotency key or a consumed body", async (method, failure) => {
    const { api, fetch, log } = await warm();
    fetch.mockImplementation(async (_url, request) => {
      await (request as Request).text();
      throw new Error(failure);
    });
    const response = await api.fetch(edgeRequest("/api/v1/dealerships", {
      method, body: "private write", headers: { "idempotency-key": "client-key" },
    }));
    await expectUnavailable(response, method);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "ApiUnavailable" })]]);
  });

  it("retries HEAD once and returns a bodyless 503", async () => {
    const { api, fetch } = await warm();
    fetch.mockRejectedValue(new Error(failures[2]));
    const response = api.fetch(edgeRequest("/api/v1/dealerships", { method: "HEAD" }));
    await vi.advanceTimersByTimeAsync(150);
    await expectUnavailable(await response, "HEAD");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("returns a successful retry without an unavailable log", async () => {
    const { api, fetch, log } = await warm();
    fetch.mockRejectedValueOnce(new Error(failures[3])).mockResolvedValue(Object.assign(new Response(null, { status: 204 }), { webSocket: null }));
    const response = api.fetch(edgeRequest("/api/v1/dealerships"));
    await vi.advanceTimersByTimeAsync(150);
    expect((await response).status).toBe(204);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(log).not.toHaveBeenCalled();
  });

  it("does not retry a request aborted during the delay", async () => {
    const { api, fetch } = await warm();
    fetch.mockRejectedValue(new Error(failures[3]));
    const controller = new AbortController();
    const response = api.fetch(edgeRequest("/api/v1/dealerships", { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await vi.advanceTimersByTimeAsync(50);
    await expectUnavailable(await response, "GET");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves the native HTTP request's method, body, query and headers", async () => {
    const { api, fetch } = await warm();
    fetch.mockResolvedValue(new Response(null, { status: 201 }));
    const request = edgeRequest("/api/v1/appointments?private=query", {
      method: "POST", body: "private write", headers: { "idempotency-key": "client-key", "x-forwarded-proto": "https" },
    });
    expect((await api.fetch(request)).status).toBe(201);
    expect(fetch).toHaveBeenCalledWith("http://keyloop.kylesmile.me/api/v1/appointments?private=query", request);
    const forwarded = fetch.mock.calls[0]![1] as Request;
    expect(forwarded.method).toBe("POST");
    expect(await forwarded.text()).toBe("private write");
    expect(forwarded.headers.get("idempotency-key")).toBe("client-key");
    expect(forwarded.headers.get("x-forwarded-proto")).toBe("https");
  });

  it("keeps the container awake during a pending request and until a streamed body finishes", async () => {
    const { api, fetch, runtime } = await warm();
    let answer!: (response: Response) => void;
    fetch.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    const pending = api.fetch(edgeRequest("/api/v1/dealerships"));
    await vi.advanceTimersByTimeAsync(0);
    await api.onActivityExpired();
    expect(runtime.signals).toEqual([]);
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    answer(new Response(new ReadableStream({ start(controller) { stream = controller; } })));
    const response = await pending;
    await api.onActivityExpired();
    expect(runtime.signals).toEqual([]);
    stream.enqueue(new TextEncoder().encode("API body"));
    stream.close();
    expect(await response.text()).toBe("API body");
    await vi.advanceTimersByTimeAsync(0);
    await api.onActivityExpired();
    expect(runtime.signals).toEqual([15]);
  });

  it.each(["GET", "POST"])("passes an API-produced 500 through unchanged for %s without retrying", async method => {
    const { api, fetch, log } = await warm();
    // Even a body resembling the SDK's error text is still a real HTTP response from the API.
    const body = "Error proxying request to container: API-generated failure";
    fetch.mockResolvedValue(Object.assign(new Response(body, { status: 500, statusText: "API failure", headers: {
      "content-type": "text/plain", "x-request-id": "api-request", "cache-control": "private",
    } }), { webSocket: null }));
    const response = await api.fetch(edgeRequest("/api/v1/dealerships", { method }));
    expect(response.status).toBe(500);
    expect(response.statusText).toBe("API failure");
    expect(await response.text()).toBe(body);
    expect(Object.fromEntries(response.headers)).toEqual({
      "content-type": "text/plain", "x-request-id": "api-request", "cache-control": "private",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it("does not multiply retries or logging when the Worker receives the container's 503", async () => {
    const { api, fetch, log } = await warm();
    fetch.mockRejectedValue(new Error(failures[0]));
    const { env, mocks } = fakeEnv();
    mocks.API.get().fetch.mockImplementation((request: Request) => api.fetch(request));
    const response = routeRequest(edgeRequest("/api/v1/dealerships"), env);
    await vi.advanceTimersByTimeAsync(150);
    await expectUnavailable(await response, "GET");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mocks.API.get().fetch).toHaveBeenCalledTimes(1);
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "ApiUnavailable" })]]);
  });
});
