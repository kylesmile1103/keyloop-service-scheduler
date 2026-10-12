import { describe, expect, it } from "vitest"

import { bookingSchema, stepOneFields, toBookingRequest, type BookingForm } from "./booking-schema"

/** A valid booking at Reading: Interim Service at 10:15 on Tuesday 13 October. */
const valid = {
  serviceTypeId: "3153f30d-5700-8f07-a25d-4a4ea44dfeef",
  date: "2026-10-13",
  startUtc: "2026-10-13T09:15:00Z",
  customer: { name: "Sophie Turner", email: "sophie.turner@example.com", phone: "+44 7700 900105" },
  vehicle: { vin: "JTDKN3DU0A0123460", registration: "RF20 BCJ", make: "Toyota", model: "Prius" },
}

const issuesAt = (input: unknown) => {
  const result = bookingSchema.safeParse(input)
  return result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message]))
}

describe("booking schema", () => {
  it("rejects_vin_with_I", () => {
    expect(issuesAt({ ...valid, vehicle: { ...valid.vehicle, vin: "JTDKN3DU0A012346I" } })).toEqual({
      "vehicle.vin": "VIN must be 17 characters (no I, O, Q)",
    })
  })

  it("uppercases_vin", () => {
    const parsed = bookingSchema.parse({ ...valid, vehicle: { ...valid.vehicle, vin: " jtdkn3du0a0123460 " } })
    expect(parsed.vehicle.vin).toBe("JTDKN3DU0A0123460")
  })

  it("requires_start", () => {
    expect(issuesAt({ ...valid, startUtc: "" })).toEqual({ startUtc: "Pick a start time" })
  })

  it("accepts the API's server-minted ids, whatever their UUID version", () => {
    expect(bookingSchema.safeParse({ ...valid, preferredBayId: "29c9f970-e13d-879e-a949-a553839cf25e" }).success).toBe(true)
    expect(issuesAt({ ...valid, serviceTypeId: "" })).toEqual({ serviceTypeId: "Choose a service" })
  })

  it("applies the API's rules to the customer and vehicle, with plain messages", () => {
    expect(
      issuesAt({
        ...valid,
        date: "13/10/2026",
        customer: { name: " ", email: "sophie@", phone: "call me" },
        vehicle: { vin: "SHORT", registration: "", make: "", model: "x".repeat(61) },
        notes: "n".repeat(1001),
      })
    ).toEqual({
      date: "Choose a date",
      "customer.name": "Enter the customer's name",
      "customer.email": "Enter an email address such as name@example.com",
      "customer.phone": "Use digits, spaces and + ( ) - only",
      "vehicle.vin": "VIN must be 17 characters (no I, O, Q)",
      "vehicle.registration": "Enter the registration",
      "vehicle.make": "Enter the make",
      "vehicle.model": "Model can be at most 60 characters",
      notes: "Notes can be at most 1000 characters",
    })
  })

  it("names the fields of the first step, so Next checks only them", () => {
    expect(stepOneFields).toEqual(["serviceTypeId", "date", "startUtc"])
  })
})

describe("toBookingRequest", () => {
  it("sends the trimmed booking, upper-casing the plate, and leaves out empty optional fields", () => {
    const form: BookingForm = bookingSchema.parse({
      ...valid,
      customer: { name: "  Sophie Turner ", email: " sophie.turner@example.com", phone: " +44 7700 900105 " },
      vehicle: { ...valid.vehicle, registration: "rf20 bcj" },
      notes: "   ",
    })
    expect(toBookingRequest(form)).toEqual({
      serviceTypeId: valid.serviceTypeId,
      startUtc: valid.startUtc,
      customer: { name: "Sophie Turner", email: "sophie.turner@example.com", phone: "+44 7700 900105" },
      vehicle: { vin: "JTDKN3DU0A0123460", registration: "RF20 BCJ", make: "Toyota", model: "Prius" },
    })
  })

  it("passes the preferred bay, technician and notes when given", () => {
    const form = bookingSchema.parse({
      ...valid,
      preferredBayId: "29c9f970-e13d-879e-a949-a553839cf25e",
      preferredTechnicianId: "bd559b63-ceea-83dd-9a48-f2bc7a515dcd",
      notes: " Customer waiting in the lounge. ",
    })
    expect(toBookingRequest(form)).toMatchObject({
      preferredBayId: "29c9f970-e13d-879e-a949-a553839cf25e",
      preferredTechnicianId: "bd559b63-ceea-83dd-9a48-f2bc7a515dcd",
      notes: "Customer waiting in the lounge.",
    })
  })
})
