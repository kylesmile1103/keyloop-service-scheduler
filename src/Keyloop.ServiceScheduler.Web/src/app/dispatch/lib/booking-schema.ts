import { z } from "zod"

import type { BookAppointmentRequest, VehicleProfileRequest } from "@/api/types.gen"
import { manufacturerCode, POWERTRAINS, VEHICLE_CLASSES } from "@/lib/vehicle-aware"

/**
 * Ids the API mints (dealerships, service types, bays, technicians). `z.guid()` checks the 8-4-4-4-12 shape without
 * insisting on an RFC 9562 version: the seeded ids are deterministic name-based ones, and the server accepts any GUID.
 */
const id = (message: string) => z.guid(message)

/** The longest declaration reason the API keeps (`VehicleProfile.MaxDeclarationReasonLength`), counted after trimming. */
export const DECLARATION_REASON_LIMIT = 500

/** The longest notes the API keeps (`Appointment.MaxNotesLength`); the form counts them as typed. */
export const NOTES_LIMIT = 1000

/** An OEM code as the API accepts it: letters, digits and hyphens, at most 32 (`VehicleProfileRequestValidator`). */
const MANUFACTURER_CODE = /^[A-Z0-9-]{1,32}$/

/**
 * What the advisor declares about the vehicle (ADR-029), on the vehicle step: kept in the form, so it is part of the
 * booking being entered and is discarded with it. Sent only while vehicle-aware requirements are on (`toBookingRequest`).
 * The server assigns provenance; nothing here can claim a source.
 */
const vehicleProfile = z.object({
  powertrain: z.enum(POWERTRAINS),
  vehicleClass: z.enum(VEHICLE_CLASSES),
  /** A manufacturer the VIN does not decode, as an OEM code; empty when the VIN decides. */
  manufacturer: z.string(),
  /** Why a concrete powertrain is declared: private, kept with the booking for audit. */
  declarationReason: z.string(),
})

/**
 * The booking dialog's form (Task 17), with the same rules as the API's validator (ARCHITECTURE §8.7, the
 * `BookAppointmentRequest` schema), so most mistakes are caught before a round trip. The server stays the authority: its
 * `400` field errors are mapped onto the same paths.
 */
export const bookingSchema = z.object({
  serviceTypeId: id("Choose a service"),
  /** The local date the slot was picked on, `yyyy-MM-dd` in the dealership's calendar. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  startUtc: z.string().min(1, "Pick a start time"),
  customer: z.object({
    name: z.string().trim().min(1, "Enter the customer's name").max(120, "Name can be at most 120 characters"),
    email: z
      .string()
      .trim()
      .min(1, "Enter an email address such as name@example.com")
      .max(254, "Email can be at most 254 characters")
      .pipe(z.email("Enter an email address such as name@example.com")),
    phone: z
      .string()
      .trim()
      .min(3, "Enter a phone number")
      .max(40, "Phone can be at most 40 characters")
      .regex(/^[+0-9 ()-]+$/, "Use digits, spaces and + ( ) - only"),
  }),
  vehicle: z.object({
    vin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-HJ-NPR-Z0-9]{17}$/, "VIN must be 17 characters (no I, O, Q)"),
    registration: z.string().trim().toUpperCase().min(1, "Enter the registration").max(16, "Registration can be at most 16 characters"),
    make: z.string().trim().min(1, "Enter the make").max(60, "Make can be at most 60 characters"),
    model: z.string().trim().min(1, "Enter the model").max(60, "Model can be at most 60 characters"),
    profile: vehicleProfile.optional(),
  }),
  /** Live working on the high-voltage system (vehicle-aware requirements only). */
  needsLiveDiagnosis: z.boolean().optional(),
  preferredBayId: id("Choose a bay").optional(),
  preferredTechnicianId: id("Choose a technician").optional(),
  notes: z.string().max(NOTES_LIMIT, `Notes can be at most ${NOTES_LIMIT} characters`).optional(),
})

/**
 * The form with vehicle-aware requirements on: the declaration rules the API applies (`VehicleProfileRequestValidator`).
 * A concrete powertrain needs a reason of 1 to 500 characters after trimming; a declared manufacturer is an OEM code.
 */
export const vehicleAwareBookingSchema = bookingSchema.superRefine((form, context) => {
  const profile = form.vehicle.profile
  if (!profile) return
  const reason = profile.declarationReason.trim()
  if (profile.powertrain !== "Unknown" && reason.length === 0) {
    context.addIssue({ code: "custom", path: ["vehicle", "profile", "declarationReason"], message: "Say why you're declaring the powertrain" })
  } else if (reason.length > DECLARATION_REASON_LIMIT) {
    context.addIssue({
      code: "custom",
      path: ["vehicle", "profile", "declarationReason"],
      message: `The reason can be at most ${DECLARATION_REASON_LIMIT} characters`,
    })
  }
  const manufacturer = manufacturerCode(profile.manufacturer)
  if (manufacturer && !MANUFACTURER_CODE.test(manufacturer)) {
    context.addIssue({
      code: "custom",
      path: ["vehicle", "profile", "manufacturer"],
      message: "Use the maker's code: letters, digits and hyphens, at most 32 (for example BMW or MERCEDES-BENZ)",
    })
  }
})

/** The form's rules for the switch as it is now (`useVehicleAware`). */
export const bookingSchemaFor = (vehicleAware: boolean) => (vehicleAware ? vehicleAwareBookingSchema : bookingSchema)

/** The form's values as typed (before trimming and upper-casing). */
export type BookingFormInput = z.input<typeof bookingSchema>
/** The form's values once valid. */
export type BookingForm = z.output<typeof bookingSchema>
export type VehicleProfileForm = z.output<typeof vehicleProfile>

/** The vehicle step's starting point: nothing declared, so the API plans for an Unknown (high-voltage) vehicle. */
export const undeclaredProfile = (): VehicleProfileForm => ({ powertrain: "Unknown", vehicleClass: "Unknown", manufacturer: "", declarationReason: "" })

/** The fields of step 1 (Service & time); Next validates only these. */
export const stepOneFields = ["serviceTypeId", "date", "startUtc"] as const satisfies ReadonlyArray<keyof BookingForm>

/** Step 1 with vehicle-aware requirements on: the vehicle's profile decides which starts are free, so it is chosen there. */
export const vehicleStepOneFields = [
  ...stepOneFields,
  "vehicle.profile.powertrain",
  "vehicle.profile.vehicleClass",
  "vehicle.profile.declarationReason",
  "needsLiveDiagnosis",
] as const

export const stepOneFieldsFor = (vehicleAware: boolean): readonly string[] => (vehicleAware ? vehicleStepOneFields : stepOneFields)

/** Whether anything about the vehicle was declared: otherwise the profile is left out and the API plans for Unknown. */
export function declaresVehicle(profile: VehicleProfileForm | undefined, needsLiveDiagnosis = false): boolean {
  return (
    needsLiveDiagnosis ||
    (profile !== undefined &&
      (profile.powertrain !== "Unknown" || profile.vehicleClass !== "Unknown" || manufacturerCode(profile.manufacturer) !== ""))
  )
}

/**
 * The profile the API is sent: what the advisor declared, never what an answer said (provenance is the server's). The
 * reason goes only with a concrete powertrain (the API keeps it only then); `UseDecoded` only once the advisor chose the
 * decoded data over a conflicting declaration. `undefined` when nothing was declared.
 */
export function toProfileRequest(profile: VehicleProfileForm | undefined, useDecoded: boolean): VehicleProfileRequest | undefined {
  if (!profile || !declaresVehicle(profile)) return undefined
  const manufacturer = manufacturerCode(profile.manufacturer)
  const reason = profile.declarationReason.trim()
  return {
    powertrain: profile.powertrain,
    vehicleClass: profile.vehicleClass,
    ...(manufacturer ? { manufacturer } : {}),
    ...(profile.powertrain !== "Unknown" ? { declarationReason: reason } : {}),
    ...(useDecoded && manufacturer ? { conflictChoice: "UseDecoded" as const } : {}),
  }
}

export interface BookingRequestOptions {
  /** Vehicle-aware requirements are on (the switch as the cache holds it when the request is built). */
  vehicleAware?: boolean
  /** The advisor chose the VIN's decoded data over a declaration that disagrees with it. */
  useDecoded?: boolean
}

/**
 * The API's body for a valid form: trimmed, with empty optional fields left out rather than sent empty. With
 * vehicle-aware requirements off nothing of the vehicle step is sent (the API would refuse it), so the body is today's.
 */
export function toBookingRequest(form: BookingForm, { vehicleAware = false, useDecoded = false }: BookingRequestOptions = {}): BookAppointmentRequest {
  const notes = form.notes?.trim()
  const { profile, ...vehicle } = form.vehicle
  const declared = vehicleAware ? toProfileRequest(profile, useDecoded) : undefined
  return {
    serviceTypeId: form.serviceTypeId,
    startUtc: form.startUtc,
    customer: form.customer,
    vehicle: declared ? { ...vehicle, profile: declared } : vehicle,
    ...(vehicleAware && form.needsLiveDiagnosis ? { needsLiveDiagnosis: true } : {}),
    ...(form.preferredBayId ? { preferredBayId: form.preferredBayId } : {}),
    ...(form.preferredTechnicianId ? { preferredTechnicianId: form.preferredTechnicianId } : {}),
    ...(notes ? { notes } : {}),
  }
}
