import { SpanStatusCode, trace } from "@opentelemetry/api"
import { InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from "@opentelemetry/sdk-trace-base"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { initTelemetry, parseKeyValueList, withSpan, type TelemetryConfig, type TelemetryHandle } from "@/lib/telemetry"

const aspire: TelemetryConfig = {
  endpoint: "https://localhost:21268",
  headers: "x-otlp-api-key=0123456789abcdef",
  resourceAttributes: "service.instance.id=web-abc",
  serviceName: "web",
}

const disabled: TelemetryConfig = { endpoint: "", headers: "", resourceAttributes: "", serviceName: "" }

const realFetch = globalThis.fetch

function stubFetch() {
  const stub = vi.fn<typeof fetch>(async () => new Response("[]", { status: 200 }))
  globalThis.fetch = stub
  return stub
}

function headerOf(stub: ReturnType<typeof stubFetch>, call: number, name: string): string | null {
  const [input, init] = stub.mock.calls[call]
  if (input instanceof Request) return input.headers.get(name)
  return new Headers(init?.headers).get(name)
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe("parseKeyValueList", () => {
  it("parses the comma-separated pairs used by OTEL_* variables, trimming whitespace", () => {
    expect(parseKeyValueList("x-otlp-api-key=abc, service.instance.id = web-1")).toEqual({
      "x-otlp-api-key": "abc",
      "service.instance.id": "web-1",
    })
  })

  it("decodes percent-encoded values and keeps '=' inside a value", () => {
    expect(parseKeyValueList("authorization=Bearer%20abc,k=a=b")).toEqual({ authorization: "Bearer abc", k: "a=b" })
  })

  it("skips entries without a key or value separator and keeps an undecodable value verbatim", () => {
    expect(parseKeyValueList("=x,novalue,,a=%E0%A4%A")).toEqual({ a: "%E0%A4%A" })
  })

  it("returns an empty set for an empty or missing list", () => {
    expect(parseKeyValueList("")).toEqual({})
    expect(parseKeyValueList(undefined)).toEqual({})
  })
})

describe("initTelemetry when no OTLP endpoint is configured", () => {
  it("does nothing: no tracer provider, fetch left untouched", async () => {
    const stub = stubFetch()

    const handle = await initTelemetry(disabled)

    expect(handle.enabled).toBe(false)
    expect(globalThis.fetch).toBe(stub)
    expect(trace.getTracer("probe").startSpan("probe").isRecording()).toBe(false)
  })

  it("reads its configuration from the build, which leaves it off in test runs", async () => {
    expect((await initTelemetry()).enabled).toBe(false)
  })
})

describe("withSpan without telemetry", () => {
  it("runs the call and returns its result", async () => {
    await expect(withSpan("ui.book_appointment", async () => 42)).resolves.toBe(42)
  })

  it("hands the call a fetch that reaches the real fetch", async () => {
    const stub = stubFetch()

    await withSpan("ui.book_appointment", ({ fetch }) => fetch("/api/v1/dealerships"))

    expect(stub).toHaveBeenCalledTimes(1)
    expect(stub.mock.calls[0][0]).toBe("/api/v1/dealerships")
  })

  it("rethrows the call's error unchanged", async () => {
    const boom = new Error("boom")

    await expect(withSpan("ui.book_appointment", async () => Promise.reject(boom))).rejects.toBe(boom)
  })
})

describe("with telemetry enabled", () => {
  let exporter: InMemorySpanExporter
  let handle: TelemetryHandle
  let stub: ReturnType<typeof stubFetch>

  beforeEach(async () => {
    stub = stubFetch()
    exporter = new InMemorySpanExporter()
    handle = await initTelemetry(aspire, { spanProcessor: new SimpleSpanProcessor(exporter) })
  })

  afterEach(async () => {
    await handle.shutdown()
  })

  const finished = (name: string): ReadableSpan[] => exporter.getFinishedSpans().filter((s) => s.name === name)
  const fetchSpans = (): ReadableSpan[] => exporter.getFinishedSpans().filter((s) => s.attributes["url.full"] !== undefined)

  it("starts once: a second call returns the same handle and does not instrument fetch twice", async () => {
    expect(handle.enabled).toBe(true)
    expect(await initTelemetry(aspire)).toBe(handle)

    await fetch("/api/v1/dealerships")

    await vi.waitFor(() => expect(fetchSpans()).toHaveLength(1))
  })

  it("names browser spans after the Aspire resource and keeps its resource attributes", async () => {
    await withSpan("ui.book_appointment", async () => undefined)

    const [span] = finished("ui.book_appointment")
    expect(span.resource.attributes["service.name"]).toBe("web-browser")
    expect(span.resource.attributes["service.instance.id"]).toBe("web-abc")
  })

  it("records a named span with its attributes and ends it", async () => {
    await withSpan("ui.book_appointment", async () => "ok", { "dealership.id": "d-1" })

    const [span] = finished("ui.book_appointment")
    expect(span.attributes["dealership.id"]).toBe("d-1")
    expect(span.status.code).not.toBe(SpanStatusCode.ERROR)
    expect(span.ended).toBe(true)
  })

  it("marks the span as failed, records the exception and rethrows", async () => {
    const boom = new Error("boom")

    await expect(withSpan("ui.stress_test", async () => Promise.reject(boom))).rejects.toBe(boom)

    const [span] = finished("ui.stress_test")
    expect(span.status).toEqual({ code: SpanStatusCode.ERROR, message: "boom" })
    expect(span.events.map((e) => e.name)).toContain("exception")
  })

  it("parents a fetch made after an await and propagates traceparent on a same-origin /api call", async () => {
    await withSpan("ui.book_appointment", async ({ fetch }) => {
      await Promise.resolve() // the generated client awaits before it calls fetch
      return fetch("/api/v1/dealerships")
    })

    await vi.waitFor(() => expect(fetchSpans()).toHaveLength(1))
    const [ui] = finished("ui.book_appointment")
    const [request] = fetchSpans()
    expect(request.parentSpanContext?.spanId).toBe(ui.spanContext().spanId)
    expect(request.spanContext().traceId).toBe(ui.spanContext().traceId)
    expect(headerOf(stub, 0, "traceparent")).toMatch(new RegExp(`^00-${ui.spanContext().traceId}-[0-9a-f]{16}-01$`))
  })

  it("does not send trace headers to another origin", async () => {
    await withSpan("ui.book_appointment", ({ fetch }) => fetch("https://elsewhere.example/api/v1/dealerships"))

    expect(headerOf(stub, 0, "traceparent")).toBeNull()
  })

  it("does not trace the exporter's own /v1/traces requests", async () => {
    await fetch("https://localhost:21268/v1/traces", { method: "POST" })
    await fetch("/api/v1/dealerships")

    await vi.waitFor(() => expect(fetchSpans()).toHaveLength(1))
    expect(fetchSpans()[0].attributes["url.full"]).toMatch(/\/api\/v1\/dealerships$/)
  })
})
