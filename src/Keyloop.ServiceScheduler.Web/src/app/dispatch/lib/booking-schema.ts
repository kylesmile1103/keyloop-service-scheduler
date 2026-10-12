import { z } from "zod"

import type { BookAppointmentRequest } from "@/api/types.gen"

/**
 * Ids the API mints (dealerships, service types, bays, technicians). `z.guid()` checks the 8-4-4-4-12 shape without
 * insisting on an RFC 9562 version: the seeded ids are deterministic name-based ones, and the server accepts any GUID.
 */
const id = (message: string) => z.guid(message)

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
  }),
  preferredBayId: id("Choose a bay").optional(),
  preferredTechnicianId: id("Choose a technician").optional(),
  notes: z.string().max(1000, "Notes can be at most 1000 characters").optional(),
})

/** The form's values as typed (before trimming and upper-casing). */
export type BookingFormInput = z.input<typeof bookingSchema>
/** The form's values once valid. */
export type BookingForm = z.output<typeof bookingSchema>

/** The fields of step 1 (Service & time); Next validates only these. */
export const stepOneFields = ["serviceTypeId", "date", "startUtc"] as const satisfies ReadonlyArray<keyof BookingForm>

/** The API's body for a valid form: trimmed, with empty optional fields left out rather than sent empty. */
export function toBookingRequest(form: BookingForm): BookAppointmentRequest {
  const notes = form.notes?.trim()
  return {
    serviceTypeId: form.serviceTypeId,
    startUtc: form.startUtc,
    customer: form.customer,
    vehicle: form.vehicle,
    ...(form.preferredBayId ? { preferredBayId: form.preferredBayId } : {}),
    ...(form.preferredTechnicianId ? { preferredTechnicianId: form.preferredTechnicianId } : {}),
    ...(notes ? { notes } : {}),
  }
}
