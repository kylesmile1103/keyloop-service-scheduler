import { describe, expect, it } from "vitest"

import { adaClio, graceGolf, graceYaris } from "@/test/returning"

import { contactOf, lookupTerm, matchesLine, returningValues, vehicleOf, visitLine } from "./returning-customer"

describe("lookupTerm", () => {
  it("sends nothing under two characters, after trimming", () => {
    expect(lookupTerm("")).toBeNull()
    expect(lookupTerm("R")).toBeNull()
    expect(lookupTerm("  R  ")).toBeNull()
    expect(lookupTerm(" RK ")).toBe("RK")
  })

  it("keeps the inner spaces and at most 100 characters", () => {
    expect(lookupTerm(" RK22 ABC ")).toBe("RK22 ABC")
    expect(lookupTerm("a".repeat(120))).toHaveLength(100)
  })
})

describe("returningValues", () => {
  it("fills every field the match has, the VIN and registration in capitals", () => {
    expect(returningValues({ ...graceGolf, vehicle: { ...graceGolf.vehicle, vin: "wvwzzz1kzaw654321", registration: "rk22 abc" } })).toEqual({
      "customer.name": "Grace Hopper",
      "customer.email": "grace.hopper@example.com",
      "customer.phone": "+44 7700 900123",
      "vehicle.vin": "WVWZZZ1KZAW654321",
      "vehicle.registration": "RK22 ABC",
      "vehicle.make": "Volkswagen",
      "vehicle.model": "Golf",
    })
  })

  it("leaves out a field the match has no value for, so it is not one the choice filled", () => {
    expect(returningValues(adaClio)).not.toHaveProperty("customer.email")
    expect(returningValues({ ...graceGolf, vehicle: { ...graceGolf.vehicle, model: "  " } })).not.toHaveProperty("vehicle.model")
  })
})

describe("what a match shows", () => {
  it("names the email, or the phone when there is no email", () => {
    expect(contactOf(graceGolf)).toBe("grace.hopper@example.com")
    expect(contactOf(adaClio)).toBe("+44 7700 900456")
  })

  it("puts the make and the model together", () => {
    expect(vehicleOf(graceYaris)).toBe("Toyota Yaris")
  })

  it("dates the last visit on the dealership's calendar, and calls a booking still to come what it is", () => {
    expect(visitLine(graceGolf, "Europe/London", "2026-10-13")).toBe("Last visit 12 Oct 2026 · 3 visits")
    expect(visitLine(graceYaris, "Europe/London", "2026-10-13")).toBe("Last visit 28 Aug 2026 · 1 visit")
    // 23:30 UTC on the 4th is 00:30 on the 5th in Reading, and still the 4th in New York.
    expect(visitLine(adaClio, "Europe/London", "2026-10-13")).toBe("Last visit 5 Oct 2026 · 2 visits")
    expect(visitLine(adaClio, "America/New_York", "2026-10-13")).toBe("Last visit 4 Oct 2026 · 2 visits")
    expect(visitLine(graceGolf, "Europe/London", "2026-10-12")).toBe("Last visit 12 Oct 2026 · 3 visits")
    expect(visitLine(graceGolf, "Europe/London", "2026-10-11")).toBe("Booked for 12 Oct 2026 · 3 visits")
  })

  it("counts the matches, and says to type more when there may be others", () => {
    expect(matchesLine(0)).toBe("No earlier bookings match. Enter the details below.")
    expect(matchesLine(1)).toBe("1 match from earlier bookings.")
    expect(matchesLine(3)).toBe("3 matches, latest first.")
    expect(matchesLine(8)).toBe("8 matches, latest first. Type more to narrow them.")
  })
})
