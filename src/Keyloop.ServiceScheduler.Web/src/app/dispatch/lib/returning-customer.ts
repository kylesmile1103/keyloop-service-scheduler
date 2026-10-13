import type { ReturningCustomerResponse } from "@/api/types.gen"
import { formatDay, todayIn } from "@/lib/calendar-date"

/**
 * The returning-customer search on step 2 of the booking dialog (Task 39b, ADR-034): staff find an earlier booking of this
 * dealership by registration, email, phone or name (`POST /customer-lookups`, `FindReturningCustomers`), and choosing one
 * fills in the customer and vehicle. The words and the field mapping live here; the combobox is
 * `components/returning-customer-search.tsx`.
 */

/** The API's bounds on the search, counted after trimming (`FindReturningCustomersRequest.query`). */
export const LOOKUP_MIN_LENGTH = 2
export const LOOKUP_MAX_LENGTH = 100
/** How long typing must pause before a search is sent. */
export const LOOKUP_DEBOUNCE_MS = 250
/** The most matches the API returns: with this many there may be more, so the line says to type more. */
export const LOOKUP_LIMIT = 8

/** What is sent for what was typed: trimmed, or `null` while it is shorter than the API takes (nothing is sent). */
export function lookupTerm(typed: string): string | null {
  const term = typed.trim()
  return term.length >= LOOKUP_MIN_LENGTH ? term.slice(0, LOOKUP_MAX_LENGTH) : null
}

/** The booking form's fields a match fills in, in the form's order. */
export const RETURNING_FIELDS = [
  "customer.name",
  "customer.email",
  "customer.phone",
  "vehicle.vin",
  "vehicle.registration",
  "vehicle.make",
  "vehicle.model",
] as const

export type ReturningField = (typeof RETURNING_FIELDS)[number]
export type ReturningValues = Partial<Record<ReturningField, string>>

/**
 * What choosing a match writes into the form: each field the match has a value for (the most recent booking's, as the
 * API returns it), the VIN and registration in capitals as the form keeps them. A field the match has no value for is
 * left as it is, so it is not one the choice filled.
 */
export function returningValues(match: ReturningCustomerResponse): ReturningValues {
  const values: ReturningValues = {}
  const put = (field: ReturningField, value: string | null | undefined, upperCase = false) => {
    const text = (value ?? "").trim()
    if (text !== "") values[field] = upperCase ? text.toUpperCase() : text
  }
  put("customer.name", match.customer.name)
  put("customer.email", match.customer.email)
  put("customer.phone", match.customer.phone)
  put("vehicle.vin", match.vehicle.vin, true)
  put("vehicle.registration", match.vehicle.registration, true)
  put("vehicle.make", match.vehicle.make)
  put("vehicle.model", match.vehicle.model)
  return values
}

/** How to reach the customer, as a match shows it: the email, or the phone when there is no email. */
export function contactOf(match: ReturningCustomerResponse): string {
  return match.customer.email.trim() || match.customer.phone.trim()
}

/** The vehicle's make and model, as one phrase ("Volkswagen Golf"). */
export function vehicleOf(match: ReturningCustomerResponse): string {
  return [match.vehicle.make, match.vehicle.model].map((part) => part.trim()).filter(Boolean).join(" ")
}

/** The date of the match's most recent booking on the dealership's calendar, for people: "12 Oct 2026". */
export function bookingDay(lastVisitUtc: string, timeZone: string): string {
  return formatDay(todayIn(timeZone, new Date(lastVisitUtc)), "dated")
}

/** "3 visits", "1 visit". */
export const visitCount = (visits: number) => `${visits} ${visits === 1 ? "visit" : "visits"}`

/**
 * A match's history line: "Last visit 12 Oct 2026 · 3 visits", in the dealership's time zone. The most recent booking
 * can still be to come (bookings are made ahead), and then it is not a visit yet: "Booked for 20 Oct 2026 · 3 visits".
 */
export function visitLine(match: ReturningCustomerResponse, timeZone: string, today: string): string {
  const day = todayIn(timeZone, new Date(match.lastVisitUtc))
  return `${day > today ? "Booked for" : "Last visit"} ${formatDay(day, "dated")} · ${visitCount(match.visits)}`
}

/** A match as a screen reader hears it, one phrase per part. */
export function matchLabel(match: ReturningCustomerResponse, timeZone: string, today: string): string {
  return [
    match.customer.name,
    `registration ${match.vehicle.registration}`,
    vehicleOf(match),
    contactOf(match),
    visitLine(match, timeZone, today).replace(" · ", ", "),
  ]
    .filter(Boolean)
    .join(", ")
}

/** What the line under the search says once the answer is in, and what is announced. */
export function matchesLine(count: number): string {
  if (count === 0) return "No earlier bookings match. Enter the details below."
  if (count === 1) return "1 match from earlier bookings."
  if (count >= LOOKUP_LIMIT) return `${count} matches, latest first. Type more to narrow them.`
  return `${count} matches, latest first.`
}
