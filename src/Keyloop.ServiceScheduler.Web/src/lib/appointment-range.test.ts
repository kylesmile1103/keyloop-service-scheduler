import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"

import { listAppointmentsQueryKey } from "@/api/@tanstack/react-query.gen"
import type { AppointmentListItemResponse, ListAppointmentsData } from "@/api/types.gen"
import { byLocalDate, datesFrom, localDateOf, MAX_RANGE_DAYS, rangeReadOptions, rangeReadsOf } from "@/lib/appointment-range"
import { munich, reading } from "@/test/dealerships"
import { appointments, bays } from "@/test/schedules"

const item = (overrides: Partial<AppointmentListItemResponse>): AppointmentListItemResponse => ({
  ...appointments.interim,
  bay: bays.standard,
  ...overrides,
})

describe("the dates of a range", () => {
  it("lists every calendar date from the first to the last, both included", () => {
    expect(datesFrom("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"])
  })

  it("counts days, not hours, across the clocks going back (25 October 2026 in Europe/London)", () => {
    expect(datesFrom("2026-10-24", "2026-10-26")).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"])
  })

  it("is empty when the range ends before it starts", () => {
    expect(datesFrom("2026-10-14", "2026-10-13")).toEqual([])
  })
})

describe("an appointment's day", () => {
  it("is the date of its local start, as the dealership's calendar has it", () => {
    // 23:30 UTC on the 12th is already the 13th in Berlin.
    expect(localDateOf({ startLocal: "2026-10-13T01:30+02:00" })).toBe("2026-10-13")
  })

  it("groups appointments by their local day, each day in start order", () => {
    const early = item({ id: "a", startUtc: "2026-10-13T07:00:00Z", startLocal: "2026-10-13T08:00+01:00" })
    const late = item({ id: "b", startUtc: "2026-10-13T12:00:00Z", startLocal: "2026-10-13T13:00+01:00" })
    const next = item({ id: "c", startUtc: "2026-10-14T07:00:00Z", startLocal: "2026-10-14T08:00+01:00" })

    const days = byLocalDate([late, next, early])

    expect([...days.keys()]).toEqual(["2026-10-13", "2026-10-14"])
    expect(days.get("2026-10-13")!.map((appointment) => appointment.id)).toEqual(["a", "b"])
  })
})

describe("the range read", () => {
  it("asks for one dealership's appointments from one local date to another, whatever their status", () => {
    const options = rangeReadOptions(reading.id, "2026-10-12", "2026-10-18")

    expect(options.queryKey).toEqual(
      listAppointmentsQueryKey({ path: { dealershipId: reading.id }, query: { from: "2026-10-12", to: "2026-10-18" } as ListAppointmentsData["query"] })
    )
    expect(options.queryKey[0].query).not.toHaveProperty("status")
  })

  it("refuses a range longer than the API's 62 days instead of sending a request the API refuses", () => {
    expect(MAX_RANGE_DAYS).toBe(62)
    expect(() => rangeReadOptions(reading.id, "2026-10-01", "2026-12-01")).not.toThrow()
    expect(() => rangeReadOptions(reading.id, "2026-10-01", "2026-12-02")).toThrow(RangeError)
  })

  it("names every range read of one dealership with one partial key, and no other dealership's", () => {
    const queryClient = new QueryClient()
    for (const [dealershipId, from, to] of [
      [reading.id, "2026-10-12", "2026-10-18"],
      [reading.id, "2026-09-29", "2026-10-27"],
      [munich.id, "2026-10-12", "2026-10-18"],
    ]) {
      queryClient.setQueryData(rangeReadOptions(dealershipId, from, to).queryKey, [])
    }

    const matched = queryClient.getQueryCache().findAll({ queryKey: rangeReadsOf(reading.id) })

    expect(matched.map((query) => (query.queryKey[0] as { query: { from: string } }).query.from)).toEqual(["2026-10-12", "2026-09-29"])
  })
})
