import { describe, expect, it } from "vitest"

import {
  formatDay,
  fromPickerDate,
  isCalendarDate,
  shiftDate,
  toPickerDate,
  todayIn,
  weekdayOf,
} from "@/lib/calendar-date"

describe("calendar dates (yyyy-MM-dd, the API's local date)", () => {
  it("knows today in the dealership's zone, not the browser's", () => {
    // 22:30Z on Friday 16 October is still Friday in London and already Saturday in Berlin.
    const instant = new Date("2026-10-16T22:30:00Z")

    expect(todayIn("Europe/London", instant)).toBe("2026-10-16")
    expect(todayIn("Europe/Berlin", instant)).toBe("2026-10-17")
  })

  it("moves by whole calendar days across month, year and daylight-saving changes", () => {
    expect(shiftDate("2026-10-13", 1)).toBe("2026-10-14")
    expect(shiftDate("2026-10-31", 1)).toBe("2026-11-01")
    expect(shiftDate("2026-10-25", -1)).toBe("2026-10-24")
    expect(shiftDate("2027-01-01", -1)).toBe("2026-12-31")
    expect(shiftDate("2028-02-28", 1)).toBe("2028-02-29")
  })

  it("accepts only real dates written exactly yyyy-MM-dd", () => {
    expect(isCalendarDate("2026-10-13")).toBe(true)
    expect(isCalendarDate("2028-02-29")).toBe(true)
    expect(isCalendarDate("2026-02-29")).toBe(false)
    expect(isCalendarDate("2026-13-01")).toBe(false)
    expect(isCalendarDate("2026-10-1")).toBe(false)
    expect(isCalendarDate("13/10/2026")).toBe(false)
    expect(isCalendarDate("")).toBe(false)
  })

  it("names the weekday of a date as the API names days", () => {
    expect(weekdayOf("2026-10-13")).toBe("Tuesday")
    expect(weekdayOf("2026-10-18")).toBe("Sunday")
  })

  it("writes a day for people", () => {
    expect(formatDay("2026-10-13", "short")).toBe("Tue 13 Oct")
    expect(formatDay("2026-10-13", "long")).toBe("Tuesday 13 October 2026")
  })

  it("converts to and from the date picker's local-midnight Date without shifting the day", () => {
    const picked = toPickerDate("2026-10-13")

    expect([picked.getFullYear(), picked.getMonth(), picked.getDate()]).toEqual([2026, 9, 13])
    expect(fromPickerDate(picked)).toBe("2026-10-13")
    expect(fromPickerDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05")
  })
})
