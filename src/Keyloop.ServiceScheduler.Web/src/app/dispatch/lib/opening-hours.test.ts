import { describe, expect, it } from "vitest"

import { munich, reading } from "@/test/dealerships"
import { firstOpenDate, hourMarks, nextOpenDate, openingHoursOn, weekdayIn } from "./opening-hours"

describe("weekdayIn", () => {
  it("names the weekday as the API does", () => {
    expect(weekdayIn("Europe/London", new Date("2026-10-12T08:00:00Z"))).toBe("Monday")
  })

  it("uses the dealership's zone, not the browser's", () => {
    // 22:30 UTC on Monday is already Tuesday 00:30 in Munich, and still Monday in London
    const lateMonday = new Date("2026-10-12T22:30:00Z")
    expect(weekdayIn("Europe/Berlin", lateMonday)).toBe("Tuesday")
    expect(weekdayIn("Europe/London", lateMonday)).toBe("Monday")
  })
})

describe("openingHoursOn", () => {
  it("returns the hours of an open day", () => {
    expect(openingHoursOn(reading, "Saturday")).toEqual({ opensAt: "08:00", closesAt: "13:00" })
  })

  it("returns null on a closed day", () => {
    expect(openingHoursOn(reading, "Sunday")).toBeNull()
  })

  it("returns null for a day the dealership does not list", () => {
    expect(openingHoursOn({ ...reading, operatingHours: [] }, "Monday")).toBeNull()
  })
})

describe("hourMarks", () => {
  it("marks every whole hour of a day on the hour", () => {
    expect(hourMarks({ opensAt: "08:00", closesAt: "18:00" })).toEqual([
      "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00",
    ])
  })

  it("widens to whole hours when the day starts or ends on the half hour", () => {
    expect(hourMarks({ opensAt: "07:30", closesAt: "18:30" })).toEqual([
      "07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00",
    ])
  })
})

describe("nextOpenDate", () => {
  it("is the next day the dealership opens, skipping its closed days", () => {
    expect(nextOpenDate(reading, "2026-10-17")).toBe("2026-10-19") // Saturday → Monday (closed Sunday)
    expect(nextOpenDate(munich, "2026-10-16")).toBe("2026-10-19") // Friday → Monday (closed at weekends)
    expect(nextOpenDate(reading, "2026-10-13")).toBe("2026-10-14")
  })

  it("is null for a dealership that never opens", () => {
    const shut = { ...reading, operatingHours: reading.operatingHours.map((day) => ({ ...day, opensAt: null, closesAt: null })) }
    expect(nextOpenDate(shut, "2026-10-13")).toBeNull()
  })
})

describe("firstOpenDate", () => {
  it("is the day itself when the dealership opens that day, else the next day it opens", () => {
    expect(firstOpenDate(reading, "2026-10-14")).toBe("2026-10-14") // Wednesday, open
    expect(firstOpenDate(reading, "2026-10-18")).toBe("2026-10-19") // Sunday, closed → Monday
    expect(firstOpenDate(munich, "2026-10-17")).toBe("2026-10-19") // Saturday, closed at weekends → Monday
  })

  it("keeps the day for a dealership that never opens", () => {
    const shut = { ...reading, operatingHours: reading.operatingHours.map((day) => ({ ...day, opensAt: null, closesAt: null })) }
    expect(firstOpenDate(shut, "2026-10-18")).toBe("2026-10-18")
  })
})
