import { describe, expect, it } from "vitest"

import type { AppointmentListItemResponse, AppointmentStatus } from "@/api/types.gen"
import { munich, reading } from "@/test/dealerships"
import { appointments, bays } from "@/test/schedules"

import {
  bookingsPerDay,
  bookingsSummary,
  cancellationsLastWeek,
  chartSummary,
  lineRuns,
  OVERVIEW_DAYS,
  overviewWindow,
  serviceMix,
  todayByStatus,
  upcomingAppointments,
} from "./overview"

/** An appointment of the range read, `minutes` after 08:00 local (BST) on `date`, lasting an hour. */
function at(date: string, hour: number, overrides: Partial<AppointmentListItemResponse> = {}): AppointmentListItemResponse {
  const pad = (value: number) => String(value).padStart(2, "0")
  const start = `${date}T${pad(hour - 1)}:00:00Z`
  const end = `${date}T${pad(hour)}:00:00Z`
  return {
    ...appointments.interim,
    bay: bays.standard,
    id: `${date}-${hour}-${overrides.status ?? "Confirmed"}-${overrides.serviceType?.code ?? "I"}`,
    startUtc: start,
    endUtc: end,
    startLocal: `${date}T${pad(hour)}:00+01:00`,
    endLocal: `${date}T${pad(hour + 1)}:00+01:00`,
    ...overrides,
  }
}

const status = (value: AppointmentStatus) => ({ status: value })

describe("the Overview's window", () => {
  it("is the 14 days before today, today and the 14 days after: 29 local dates", () => {
    expect(overviewWindow("2026-10-13")).toEqual({ from: "2026-09-29", to: "2026-10-27" })
    expect(OVERVIEW_DAYS).toBe(29)
  })

  it("keeps whole local days across the clocks going back", () => {
    expect(overviewWindow("2026-10-25")).toEqual({ from: "2026-10-11", to: "2026-11-08" })
  })
})

describe("bookings per day", () => {
  it("counts every appointment but cancelled ones on its local date, closed days and where today falls included", () => {
    const days = bookingsPerDay(
      [at("2026-10-12", 9), at("2026-10-13", 9), at("2026-10-13", 10, status("Completed")), at("2026-10-13", 11, status("Cancelled"))],
      reading,
      "2026-10-13"
    )

    expect(days).toHaveLength(29)
    expect(days[0]).toEqual({ date: "2026-09-29", count: 0, closed: false, when: "past" })
    expect(days.find((day) => day.date === "2026-10-12")).toMatchObject({ count: 1, when: "past" })
    expect(days.find((day) => day.date === "2026-10-13")).toEqual({ date: "2026-10-13", count: 2, closed: false, when: "today" })
    // Reading is closed on Sundays.
    expect(days.find((day) => day.date === "2026-10-18")).toEqual({ date: "2026-10-18", count: 0, closed: true, when: "future" })
  })

  it("marks the dealership's own closed weekdays (München closes at weekends)", () => {
    const closed = bookingsPerDay([], munich, "2026-10-13").filter((day) => day.closed).map((day) => day.date)
    expect(closed).toEqual(["2026-10-03", "2026-10-04", "2026-10-10", "2026-10-11", "2026-10-17", "2026-10-18", "2026-10-24", "2026-10-25"])
  })

  it("sums the fortnight behind, today and the fortnight ahead, and names the busiest day (the earliest of equals)", () => {
    const summary = bookingsSummary(
      bookingsPerDay([at("2026-10-01", 9), at("2026-10-01", 10), at("2026-10-13", 9), at("2026-10-20", 9), at("2026-10-20", 10)], reading, "2026-10-13")
    )

    expect(summary).toMatchObject({ past: 2, today: 1, ahead: 2, total: 5, peak: 2 })
    expect(summary.busiest?.date).toBe("2026-10-01")
  })

  it("has no busiest day when nothing is booked", () => {
    expect(bookingsSummary(bookingsPerDay([], reading, "2026-10-13"))).toMatchObject({ total: 0, busiest: null, peak: 0 })
  })

  it("breaks the line at each closed day with nothing booked, and joins a closed day that has bookings", () => {
    const days = bookingsPerDay([at("2026-10-11", 9)], reading, "2026-10-13")
    const runs = lineRuns(days)

    // Sundays 4, 11 (booked, so joined), 18 and 25 October: the 4th, 18th and 25th break the line.
    const dates = runs.map((run) => [days[run[0]].date, days[run.at(-1)!].date])
    expect(dates).toEqual([
      ["2026-09-29", "2026-10-03"],
      ["2026-10-05", "2026-10-17"],
      ["2026-10-19", "2026-10-24"],
      ["2026-10-26", "2026-10-27"],
    ])
  })

  it("says the same in one sentence, the chart's text alternative", () => {
    const days = bookingsPerDay([at("2026-10-01", 9), at("2026-10-01", 10), at("2026-10-13", 9), at("2026-10-20", 9)], reading, "2026-10-13")

    expect(chartSummary(bookingsSummary(days))).toBe(
      "2 in the last 14 days, 1 today and 1 booked so far for the next 14. Busiest: Thursday 1 October, with 2."
    )
    expect(chartSummary(bookingsSummary(bookingsPerDay([], reading, "2026-10-13")))).toBe(
      "0 in the last 14 days, 0 today and 0 booked so far for the next 14."
    )
  })
})

describe("the service mix", () => {
  const service = (code: string, name: string) => ({ serviceType: { id: code, code, name, durationMinutes: 60 } })

  it("counts bookings by service, most first (then by name), leaving cancelled ones out", () => {
    const mix = serviceMix([
      at("2026-10-12", 9, service("MOT", "MOT Test")),
      at("2026-10-12", 10, service("BRAKES", "Brake Pads & Discs")),
      at("2026-10-13", 9, service("MOT", "MOT Test")),
      at("2026-10-13", 10, { ...service("MOT", "MOT Test"), status: "Cancelled" }),
      at("2026-10-14", 9, service("ALIGN", "Four-Wheel Alignment")),
    ])

    expect(mix.total).toBe(4)
    expect(mix.services).toEqual([
      { id: "MOT", name: "MOT Test", count: 2, share: 0.5 },
      { id: "BRAKES", name: "Brake Pads & Discs", count: 1, share: 0.25 },
      { id: "ALIGN", name: "Four-Wheel Alignment", count: 1, share: 0.25 },
    ])
    expect(mix.other).toBeNull()
  })

  it("gathers the services after the first five into one row, saying how many services it holds", () => {
    const codes = ["A", "B", "C", "D", "E", "F", "G"]
    const mix = serviceMix(codes.flatMap((code, index) => Array.from({ length: 7 - index }, (_, n) => at("2026-10-13", 9 + n, service(code, `Service ${code}`)))))

    expect(mix.services.map((entry) => entry.name)).toEqual(["Service A", "Service B", "Service C", "Service D", "Service E"])
    expect(mix.other).toEqual({ count: 3, services: 2, share: 3 / 28 })
  })
})

describe("upcoming appointments", () => {
  it("lists the confirmed, checked-in and in-progress work that has not finished, soonest first, at most six", () => {
    const now = new Date("2026-10-13T08:30:00Z") // 09:30 BST
    const list = upcomingAppointments(
      [
        at("2026-10-13", 8), // 08:00-09:00, finished
        at("2026-10-13", 9, status("InProgress")), // 09:00-10:00, under way
        at("2026-10-13", 10, status("NoShow")),
        at("2026-10-13", 11, status("Cancelled")),
        at("2026-10-13", 12, status("Completed")),
        ...[13, 14, 15, 16, 17, 18, 19].map((hour) => at("2026-10-14", hour, hour === 13 ? status("CheckedIn") : {})),
      ],
      now
    )

    expect(list.map((appointment) => `${appointment.startLocal.slice(5, 16)} ${appointment.status}`)).toEqual([
      "10-13T09:00 InProgress",
      "10-14T13:00 CheckedIn",
      "10-14T14:00 Confirmed",
      "10-14T15:00 Confirmed",
      "10-14T16:00 Confirmed",
      "10-14T17:00 Confirmed",
    ])
  })
})

describe("today by status", () => {
  it("counts today's appointments on the dealership's calendar by status, cancelled ones apart", () => {
    const today = todayByStatus(
      [at("2026-10-12", 9), at("2026-10-13", 9), at("2026-10-13", 10, status("InProgress")), at("2026-10-13", 11, status("Cancelled"))],
      "2026-10-13"
    )

    expect(today.total).toBe(2)
    expect(Object.fromEntries(today.counts)).toEqual({ Confirmed: 1, InProgress: 1 })
    expect(today.cancelled).toBe(1)
  })
})

describe("cancellations in the last seven days", () => {
  it("counts the cancelled appointments due today and on the six days before, out of every appointment due then", () => {
    const week = cancellationsLastWeek(
      [
        at("2026-10-06", 9, status("Cancelled")), // eight days ago: outside
        at("2026-10-07", 9, status("Cancelled")),
        at("2026-10-07", 10),
        at("2026-10-13", 9, status("Cancelled")),
        at("2026-10-13", 10, status("Completed")),
        at("2026-10-14", 9, status("Cancelled")), // tomorrow: outside
      ],
      "2026-10-13"
    )

    expect(week).toEqual({ from: "2026-10-07", to: "2026-10-13", cancelled: 2, due: 4 })
  })
})
