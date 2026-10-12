import { describe, expect, it, vi } from "vitest"

import { initTelemetry } from "@/lib/telemetry"

// A plain flag, not vi.fn(): restoreMocks clears mock call history before each test, after the import already ran.
const sdk = vi.hoisted(() => ({ loaded: false, endpoint: "" }))

vi.mock("@/lib/telemetry-sdk", async (importOriginal) => {
  sdk.loaded = true
  const actual = await importOriginal<typeof import("@/lib/telemetry-sdk")>()
  return {
    ...actual,
    startBrowserTracing: (options: import("@/lib/telemetry-sdk").BrowserTracingOptions) => {
      sdk.endpoint = options.endpoint
      return { stop: async () => {} }
    },
  }
})

describe("browser tracing SDK loading", () => {
  it("does not load the OpenTelemetry SDK when telemetry is off, so production users never download it", async () => {
    await initTelemetry({ endpoint: "", headers: "", resourceAttributes: "", serviceName: "" })

    expect(sdk.loaded).toBe(false)
  })

  it("trims trailing slashes and whitespace before wiring the OTLP exporter", async () => {
    const handle = await initTelemetry({ endpoint: " https://collector.example.invalid/otlp/// ", headers: "", resourceAttributes: "", serviceName: "web" })
    expect(handle.enabled).toBe(true)
    expect(sdk.endpoint).toBe("https://collector.example.invalid/otlp")
    await handle.shutdown()
  })
})
