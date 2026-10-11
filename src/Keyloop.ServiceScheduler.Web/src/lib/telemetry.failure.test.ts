import { describe, expect, it, vi } from "vitest"

import { initTelemetry } from "@/lib/telemetry"

vi.mock("@opentelemetry/sdk-trace-web", () => ({
  WebTracerProvider: class {
    constructor() {
      throw new Error("tracer provider unavailable")
    }
  },
}))

describe("initTelemetry when the SDK cannot start", () => {
  it("reports the failure on the console and leaves the app running without telemetry", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const before = globalThis.fetch

    const handle = await initTelemetry({
      endpoint: "https://localhost:21268",
      headers: "x-otlp-api-key=0123456789abcdef",
      resourceAttributes: "",
      serviceName: "web",
    })

    expect(handle.enabled).toBe(false)
    expect(globalThis.fetch).toBe(before)
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0][0])).toContain("Browser tracing is off")
    expect(JSON.stringify(error.mock.calls)).not.toContain("0123456789abcdef")
  })
})
