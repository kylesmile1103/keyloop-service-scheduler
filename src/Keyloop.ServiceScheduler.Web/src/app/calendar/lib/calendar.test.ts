import { describe, expect, it } from "vitest"

import type { AppointmentListItemResponse } from "@/api/types.gen"
import { MAX_RANGE_DAYS } from "@/lib/appointment-range"
import { munich, reading } from "@/test/dealerships"
import { appointments, bays } from "@/test/schedules"

import { bookableDay, calendarDays, calendarRange, onCalendar, rangeTitle, shiftAnchor, weekStart } from "./calendar"

describe("weeks", () => {
  it("start on Monday, as the UK and Germany count them", () => {
    expect(weekStart("2026-10-13")).toBe("2026-10-12") // Tuesday
    expect(weekStart("2026-10-12")).toBe("2026-10-12") // Monday
    expect(weekStart("2026-10-18")).toBe("2026-10-12") // Sunday ends the week
  })

  it("cover Monday to Sunday, across the clocks going back on 25 October", () => {
    expect(calendarRange("week", "2026-10-25")).toEqual({ from: "2026-10-19", to: "2026-10-25" })
  })
})

describe("months", () => {
  it("cover whole weeks from the Monday on or before the 1st to the Sunday on or after the last day", () => {
    // October 2026 starts on a Thursday and ends on a Saturday: five rows.
    expect(calendarRange("month", "2026-10-13")).toEqual({ from: "2026-09-28", to: "2026-11-01" })
    // March 2026 starts on a Sunday and ends on a Tuesday: six rows, 42 days, within the API's 62.
    const march = calendarRange("month", "2026-03-31")
    expect(march).toEqual({ from: "2026-02-23", to: "2026-04-05" })
    expect(calendarDays(march).length).toBe(42)
    expect(42).toBeLessThanOrEqual(MAX_RANGE_DAYS)
  })

  it("lists every day of the range in order", () => {
    expect(calendarDays({ from: "2026-10-31", to: "2026-11-02" })).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"])
  })
})

describe("moving", () => {
  it("moves a week by seven days and a month to the first of the month before or after", () => {
    expect(shiftAnchor("week", "2026-10-13", 1)).toBe("2026-10-20")
    expect(shiftAnchor("week", "2026-10-13", -1)).toBe("2026-10-06")
    expect(shiftAnchor("month", "2026-10-31", 1)).toBe("2026-11-01")
    expect(shiftAnchor("month", "2026-01-15", -1)).toBe("2025-12-01")
  })
})

describe("titles", () => {
  it("names a week by its days and a month by its name", () => {
    expect(rangeTitle("week", "2026-10-13")).toBe("12–18 October 2026")
    expect(rangeTitle("week", "2026-10-01")).toBe("28 September – 4 October 2026")
    expect(rangeTitle("week", "2026-12-31")).toBe("28 December 2026 – 3 January 2027")
    expect(rangeTitle("month", "2026-10-13")).toBe("October 2026")
  })
})

describe("what the calendar shows", () => {
  const item = (status: AppointmentListItemResponse["status"], id: string): AppointmentListItemResponse => ({
    ...appointments.interim,
    bay: bays.standard,
    id,
    status,
  })

  it("leaves cancelled appointments out, as the board and the list do, and keeps every other status", () => {
    const shown = onCalendar([item("Confirmed", "a"), item("Cancelled", "b"), item("NoShow", "c"), item("Completed", "d")])
    expect(shown.map((appointment) => appointment.id)).toEqual(["a", "c", "d"])
  })
})

describe("the day a New appointment starts on", () => {
  it("is the chosen day when it is today or later and the dealership opens then", () => {
    expect(bookableDay(reading, "2026-10-14", "2026-10-13")).toBe("2026-10-14")
    expect(bookableDay(reading, "2026-10-13", "2026-10-13")).toBe("2026-10-13")
  })

  it("is null for a past day or a closed one, which offer no New appointment", () => {
    expect(bookableDay(reading, "2026-10-12", "2026-10-13")).toBeNull()
    expect(bookableDay(reading, "2026-10-18", "2026-10-13")).toBeNull() // Sunday
    expect(bookableDay(munich, "2026-10-17", "2026-10-13")).toBeNull() // Saturday
  })
})
