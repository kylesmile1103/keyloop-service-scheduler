import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"

import { getDealershipsOptions } from "@/api/@tanstack/react-query.gen"
import { createClient } from "@/api/client"
import { getDealerships } from "@/api/sdk.gen"
import { createClientConfig } from "@/api/runtime"
import { client, configureApiClient } from "@/lib/api-client"
import { reading } from "@/test/dealerships"
import { jsonResponse, mockApi, problemResponse } from "@/test/mock-api"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe("generated API client", () => {
  it("lists dealerships with GET /api/v1/dealerships through the generated query options", async () => {
    const api = mockApi(() => jsonResponse([reading]))

    const dealerships = await new QueryClient().fetchQuery(getDealershipsOptions())

    expect(dealerships).toEqual([reading])
    expect(api.requests).toHaveLength(1)
    expect(api.requests[0].method).toBe("GET")
    expect(new URL(api.requests[0].url).pathname).toBe("/api/v1/dealerships")
  })

  it("sends a fresh X-Request-Id (a UUID) with every request", async () => {
    const api = mockApi(() => jsonResponse([reading]))

    await new QueryClient().fetchQuery(getDealershipsOptions())
    await new QueryClient().fetchQuery(getDealershipsOptions())

    const [first, second] = api.requests.map((request) => request.headers.get("X-Request-Id"))
    expect(first).toMatch(uuid)
    expect(second).toMatch(uuid)
    expect(second).not.toBe(first)
  })

  it("stamps requests that bring their own fetch, such as the span helper's", async () => {
    const api = mockApi(() => jsonResponse([]))
    const spanFetch = vi.fn(async (request: Request) => {
      expect(request.headers.get("X-Request-Id")).toMatch(uuid)
      return jsonResponse([reading])
    })

    const { data } = await getDealerships({ fetch: spanFetch as typeof fetch })

    expect(data).toEqual([reading])
    expect(spanFetch).toHaveBeenCalledOnce()
    expect(api.requests).toHaveLength(0)
  })

  it("keeps an X-Request-Id the caller chose, so a caller can correlate its own requests", async () => {
    const api = mockApi(() => jsonResponse([reading]))

    const chosen = "7d1e5c4a-9b0f-4c3e-8a2d-6f1b3c5e7a90"

    await getDealerships({ headers: { "X-Request-Id": chosen } })

    expect(api.requests[0].headers.get("X-Request-Id")).toBe(chosen)
  })

  it("passes a problem body through unchanged as the error", async () => {
    const problem = {
      type: "https://api.keyloop.example/problems/rate-limited",
      title: "Too many requests",
      status: 429,
      traceId: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      retryAfterSeconds: 3,
    }
    mockApi(() => problemResponse(429, problem))

    const { error } = await getDealerships()

    expect(error).toEqual(problem)
  })

  it("names the HTTP status when a failure has no problem body", async () => {
    mockApi(() => new Response("", { status: 500, statusText: "Internal Server Error" }))

    const { error } = await getDealerships()

    expect(error).toMatchObject({ name: "UnexpectedResponseError", status: 500, statusText: "Internal Server Error" })
  })

  it("leaves a successful response it cannot read as it is, instead of blaming a status", async () => {
    mockApi(() => new Response("{not json", { status: 200, headers: { "Content-Type": "application/json" } }))

    const { error } = await getDealerships()

    expect(error).toBeInstanceOf(SyntaxError)
  })

  it("registers each interceptor once however often the client is configured", () => {
    const fresh = createClient()

    configureApiClient(fresh)
    configureApiClient(fresh)

    expect(fresh.interceptors.request.fns.filter(Boolean)).toHaveLength(1)
    expect(fresh.interceptors.error.fns.filter(Boolean)).toHaveLength(1)
  })

  it("is the client the generated SDK uses", () => {
    expect(client.getConfig().baseUrl).toBe(import.meta.env.VITE_API_BASE_URL)
  })
})

describe("createClientConfig", () => {
  it("calls the API on the page's own origin unless VITE_API_BASE_URL is set", () => {
    vi.stubEnv("VITE_API_BASE_URL", undefined)

    expect(createClientConfig().baseUrl).toBe("")
  })

  it("uses VITE_API_BASE_URL without a trailing slash", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://scheduler.example.com/")

    expect(createClientConfig().baseUrl).toBe("https://scheduler.example.com")
  })

  it("puts no request id in the shared configuration, where it would be reused by every request", () => {
    const headers = new Headers(createClientConfig().headers as HeadersInit | undefined)

    expect(headers.has("X-Request-Id")).toBe(false)
  })
})
