import { describe, expect, it } from "vitest"

import {
  bookingSchema,
  stepOneFields,
  stepOneFieldsFor,
  toBookingRequest,
  type BookingForm,
  undeclaredProfile,
  vehicleAwareBookingSchema,
} from "./booking-schema"

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

describe("the vehicle step's declaration", () => {
  const declared = (profile: Partial<ReturnType<typeof undeclaredProfile>>) => ({
    ...valid,
    vehicle: { ...valid.vehicle, profile: { ...undeclaredProfile(), ...profile } },
  })
  const vehicleIssues = (input: unknown) => {
    const result = vehicleAwareBookingSchema.safeParse(input)
    return result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message]))
  }

  it("needs a reason for a concrete powertrain, counted after trimming, and none for Unknown", () => {
    expect(vehicleIssues(declared({ powertrain: "Ice", declarationReason: "   " }))).toEqual({
      "vehicle.profile.declarationReason": "Say why you're declaring the powertrain",
    })
    expect(vehicleIssues(declared({ powertrain: "BatteryElectric", declarationReason: "x".repeat(501) }))).toEqual({
      "vehicle.profile.declarationReason": "The reason can be at most 500 characters",
    })
    expect(vehicleIssues(declared({ powertrain: "Ice", declarationReason: ` ${"x".repeat(500)} ` }))).toEqual({})
    expect(vehicleIssues(declared({ powertrain: "Unknown", vehicleClass: "Heavy" }))).toEqual({})
  })

  it("takes a declared manufacturer only as an OEM code, ignoring case", () => {
    expect(vehicleIssues(declared({ manufacturer: "Land Rover" }))).toEqual({
      "vehicle.profile.manufacturer": "Use the maker's code: letters, digits and hyphens, at most 32 (for example BMW or MERCEDES-BENZ)",
    })
    expect(vehicleIssues(declared({ manufacturer: " mercedes-benz " }))).toEqual({})
  })

  it("applies none of it with vehicle-aware requirements off, where nothing of it is sent", () => {
    expect(bookingSchema.safeParse(declared({ powertrain: "Ice", declarationReason: "" })).success).toBe(true)
  })

  it("checks the vehicle on step 1, with the start it decides", () => {
    expect(stepOneFieldsFor(false)).toEqual(stepOneFields)
    expect(stepOneFieldsFor(true)).toEqual([
      "serviceTypeId",
      "date",
      "startUtc",
      "vehicle.profile.powertrain",
      "vehicle.profile.vehicleClass",
      "vehicle.profile.declarationReason",
      "needsLiveDiagnosis",
    ])
  })

  it("sends nothing of the vehicle step while vehicle-aware requirements are off: today's body", () => {
    const form = bookingSchema.parse({ ...declared({ powertrain: "Ice", declarationReason: "Diesel" }), needsLiveDiagnosis: true })
    expect(toBookingRequest(form)).toEqual({
      serviceTypeId: valid.serviceTypeId,
      startUtc: valid.startUtc,
      customer: valid.customer,
      vehicle: { vin: "JTDKN3DU0A0123460", registration: "RF20 BCJ", make: "Toyota", model: "Prius" },
    })
  })

  it("leaves the profile out when nothing was declared, so the API plans for an Unknown vehicle", () => {
    const form = vehicleAwareBookingSchema.parse({ ...declared({}), needsLiveDiagnosis: false })
    expect(toBookingRequest(form, { vehicleAware: true })).toEqual(toBookingRequest(form))
  })

  it("sends the declaration with its trimmed reason, the upper-case code and the live flag, never a provenance", () => {
    const form = vehicleAwareBookingSchema.parse({
      ...declared({ powertrain: "BatteryElectric", vehicleClass: "Car", manufacturer: " vw-group ", declarationReason: "  Customer says EV  " }),
      needsLiveDiagnosis: true,
    })
    const body = toBookingRequest(form, { vehicleAware: true })
    expect(body.vehicle.profile).toEqual({
      powertrain: "BatteryElectric",
      vehicleClass: "Car",
      manufacturer: "VW-GROUP",
      declarationReason: "Customer says EV",
    })
    expect(body.needsLiveDiagnosis).toBe(true)
    expect(JSON.stringify(body)).not.toContain("provenance")
  })

  it("keeps a reason typed for a powertrain set back to Unknown out of the request, and sends UseDecoded only with a declared manufacturer", () => {
    const unknown = vehicleAwareBookingSchema.parse(declared({ powertrain: "Unknown", vehicleClass: "Heavy", declarationReason: "Typed, then undone" }))
    expect(toBookingRequest(unknown, { vehicleAware: true, useDecoded: true }).vehicle.profile).toEqual({ powertrain: "Unknown", vehicleClass: "Heavy" })

    const conflicting = vehicleAwareBookingSchema.parse(declared({ manufacturer: "BMW" }))
    expect(toBookingRequest(conflicting, { vehicleAware: true, useDecoded: true }).vehicle.profile).toEqual({
      powertrain: "Unknown",
      vehicleClass: "Unknown",
      manufacturer: "BMW",
      conflictChoice: "UseDecoded",
    })
  })
})
