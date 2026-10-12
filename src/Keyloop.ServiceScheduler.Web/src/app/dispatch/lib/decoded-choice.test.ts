import { describe, expect, it } from "vitest"

import type { BookAppointmentRequest } from "@/api/types.gen"
import { decodedMercedes, decodedVolkswagen } from "@/test/vehicle"

import { choiceHolds, choiceOfRequest, type DecodedChoice, decodedOf } from "./decoded-choice"

const vin = "WVWZZZ1KZAW654321"
const declaredBmw = { powertrain: "Unknown", vehicleClass: "Unknown", manufacturer: "BMW" } as const

const madeFor = (overrides: Partial<DecodedChoice> = {}): DecodedChoice => ({
  vin,
  declared: declaredBmw,
  decoded: decodedOf(decodedVolkswagen),
  ...overrides,
})

describe("a Use decoded data choice", () => {
  it("holds for the VIN, declaration and decoded attributes it was made for", () => {
    expect(choiceHolds(madeFor(), madeFor())).toBe(true)
  })

  it("does not hold once the VIN, a declared attribute or the decoded attributes differ", () => {
    expect(choiceHolds(madeFor(), madeFor({ vin: "WDD12345678901234" }))).toBe(false)
    expect(choiceHolds(madeFor(), madeFor({ declared: { ...declaredBmw, manufacturer: "AUDI" } }))).toBe(false)
    expect(choiceHolds(madeFor(), madeFor({ declared: { ...declaredBmw, powertrain: "Ice" } }))).toBe(false)
    expect(choiceHolds(madeFor(), madeFor({ declared: { ...declaredBmw, vehicleClass: "Heavy" } }))).toBe(false)
    expect(choiceHolds(madeFor(), madeFor({ decoded: decodedOf(decodedMercedes) }))).toBe(false)
    expect(choiceHolds(madeFor(), madeFor({ decoded: null }))).toBe(false)
  })

  it("made without a look-up, holds for its VIN and declaration whatever a later look-up of that VIN says, and no other VIN", () => {
    const withoutLookUp = madeFor({ decoded: null })
    expect(choiceHolds(withoutLookUp, madeFor({ decoded: null }))).toBe(true)
    expect(choiceHolds(withoutLookUp, madeFor())).toBe(true)
    // The checker's probe: the same choice must not answer for a Mercedes VIN.
    expect(choiceHolds(withoutLookUp, madeFor({ vin: "WDD12345678901234", decoded: decodedOf(decodedMercedes) }))).toBe(false)
    expect(choiceHolds(withoutLookUp, madeFor({ vin: "WDD12345678901234", decoded: null }))).toBe(false)
  })

  it("is no choice at all when none was made", () => {
    expect(choiceHolds(null, madeFor())).toBe(false)
  })

  it("is read from a request as it was sent: the VIN, and the declaration with Unknown for what it left out", () => {
    const request = {
      serviceTypeId: "3153f30d-5700-8f07-a25d-4a4ea44dfeef",
      startUtc: "2026-10-13T09:15:00Z",
      customer: { name: "Grace Hopper", email: "grace.hopper@example.com", phone: "+44 7700 900123" },
      vehicle: { vin, registration: "RK22 ABC", make: "Volkswagen", model: "Golf", profile: { powertrain: "Unknown", vehicleClass: "Unknown", manufacturer: "BMW" } },
    } satisfies BookAppointmentRequest
    expect(choiceOfRequest(request, null)).toEqual(madeFor({ decoded: null }))
    const undeclared = { ...request, vehicle: { vin, registration: "RK22 ABC", make: "Volkswagen", model: "Golf" } }
    expect(choiceOfRequest(undeclared, null).declared).toEqual({ powertrain: "Unknown", vehicleClass: "Unknown", manufacturer: "" })
  })
})
