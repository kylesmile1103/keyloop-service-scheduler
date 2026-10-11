import { afterEach, describe, expect, it, vi } from "vitest"

import { jsonResponse, mockApi, problemResponse } from "@/test/mock-api"
import { interimDetails } from "@/test/schedules"

import { fireParallelBookings, latency, outcomeKind, stressBooking, tally, type StressOutcome } from "./stress"

const outcome = (index: number, status: number, slug: string | null = null, durationMs = 10): StressOutcome => ({
  index,
  status,
  slug,
  traceId: slug ? `00-trace-${index}-01` : null,
  durationMs,
})

describe("tally", () => {
  it("tally_counts_by_status_and_slug", () => {
    expect(
      tally([
        outcome(0, 409, "slot-unavailable"),
        outcome(1, 201),
        outcome(2, 409, "slot-unavailable"),
        outcome(3, 409, "slot-conflict"),
        outcome(4, 503),
        outcome(5, 500),
        outcome(6, 429, "rate-limited"),
      ])
    ).toEqual([
      { label: "201 Created", count: 1 },
      { label: "409 slot-unavailable", count: 2 },
      { label: "409 slot-conflict", count: 1 },
      { label: "429 rate-limited", count: 1 },
      { label: "5xx", count: 2 },
    ])
  })

  it("tally_always_includes_5xx_row", () => {
    expect(tally([outcome(0, 201), outcome(1, 409, "slot-unavailable")])).toEqual([
      { label: "201 Created", count: 1 },
      { label: "409 slot-unavailable", count: 1 },
      { label: "5xx", count: 0 },
    ])
    expect(tally([])).toEqual([{ label: "5xx", count: 0 }])
  })

  it("counts a request that got no answer apart from the server's errors", () => {
    expect(tally([outcome(0, 0)])).toEqual([
      { label: "5xx", count: 0 },
      { label: "No response", count: 1 },
    ])
  })
})

describe("outcomeKind", () => {
  it("sorts every status into the traffic light's outcomes", () => {
    expect([201, 409, 429, 500, 503, 0, 400, 422].map(outcomeKind)).toEqual([
      "booked",
      "taken",
      "rate-limited",
      "server",
      "server",
      "failed",
      "other",
      "other",
    ])
  })
})

describe("latency", () => {
  it("gives the median, the 95th percentile (nearest rank) and the slowest request", () => {
    const outcomes = Array.from({ length: 20 }, (_, index) => outcome(index, 409, "slot-unavailable", (index + 1) * 10))
    expect(latency(outcomes)).toEqual({ p50: 100, p95: 190, max: 200 })
    expect(latency([])).toBeNull()
  })
})

describe("stressBooking", () => {
  it("gives every request its own customer and a valid, distinct VIN", () => {
    const first = stressBooking(0, { serviceTypeId: "s", startUtc: "2026-10-13T09:00:00Z" })
    const last = stressBooking(29, { serviceTypeId: "s", startUtc: "2026-10-13T09:00:00Z" })
    expect(first.vehicle.vin).toMatch(/^[A-HJ-NPR-Z0-9]{17}$/)
    expect(last.vehicle.vin).toMatch(/^[A-HJ-NPR-Z0-9]{17}$/)
    expect(first.vehicle.vin).not.toBe(last.vehicle.vin)
    expect(first.customer.email).not.toBe(last.customer.email)
    expect(first.customer.name).toBe("Stress test 1")
    expect(last.customer.name).toBe("Stress test 30")
  })
})

describe("fireParallelBookings", () => {
  afterEach(() => vi.useRealTimers())

  it("sends every booking at once and reports each answer's status, slug and trace id", async () => {
    let inFlight = 0
    let peak = 0
    let booked = false
    const api = mockApi(async (request) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
      if (!booked) {
        booked = true
        return jsonResponse(interimDetails, { status: 201 })
      }
      const { vehicle } = (await request.clone().json()) as { vehicle: { vin: string } }
      return problemResponse(409, {
        type: "https://api.keyloop.example/problems/slot-unavailable",
        title: "Slot unavailable",
        status: 409,
        traceId: `00-${vehicle.vin}-01`,
      })
    })
    const settled: number[] = []

    const outcomes = await fireParallelBookings(
      5,
      (index) => stressBooking(index, { serviceTypeId: "3153f30d-5700-8f07-a25d-4a4ea44dfeef", startUtc: "2026-10-13T09:00:00Z" }),
      "45fa64a1-baa9-8c61-b11a-ee9d7572ae3e",
      { onSettled: (result) => settled.push(result.index) }
    )

    expect(peak).toBe(5)
    expect(api.requests.map((request) => new URL(request.url).pathname)).toEqual(
      Array(5).fill("/api/v1/dealerships/45fa64a1-baa9-8c61-b11a-ee9d7572ae3e/appointments")
    )
    expect(new Set(await Promise.all(api.requests.map(async (request) => ((await request.clone().json()) as { vehicle: { vin: string } }).vehicle.vin))).size).toBe(5)
    expect(outcomes.map((result) => result.index)).toEqual([0, 1, 2, 3, 4])
    expect(outcomes.filter((result) => result.status === 201)).toHaveLength(1)
    const conflicts = outcomes.filter((result) => result.status === 409)
    expect(conflicts).toHaveLength(4)
    for (const conflict of conflicts) {
      expect(conflict.slug).toBe("slot-unavailable")
      expect(conflict.traceId).toMatch(/^00-KLSTRESS/)
    }
    expect(outcomes.every((result) => result.durationMs >= 0)).toBe(true)
    expect([...settled].sort()).toEqual([0, 1, 2, 3, 4])
  })

  it("records a request that got no answer as status 0", async () => {
    mockApi(() => Promise.reject(new TypeError("Failed to fetch")))
    const [result] = await fireParallelBookings(1, (index) => stressBooking(index, { serviceTypeId: "s", startUtc: "x" }), "d")
    expect(result).toMatchObject({ index: 0, status: 0, slug: null, traceId: null })
  })
})
