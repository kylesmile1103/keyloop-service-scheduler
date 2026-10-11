import { describe, expect, it, vi } from "vitest"

import { initTelemetry } from "@/lib/telemetry"

// A plain flag, not vi.fn(): restoreMocks clears mock call history before each test, after the import already ran.
const sdk = vi.hoisted(() => ({ loaded: false }))

vi.mock("@/lib/telemetry-sdk", async (importOriginal) => {
  sdk.loaded = true
  return importOriginal()
})

describe("browser tracing SDK loading", () => {
  it("does not load the OpenTelemetry SDK when telemetry is off, so production users never download it", async () => {
    await initTelemetry({ endpoint: "", headers: "", resourceAttributes: "", serviceName: "" })

    expect(sdk.loaded).toBe(false)
  })
})
