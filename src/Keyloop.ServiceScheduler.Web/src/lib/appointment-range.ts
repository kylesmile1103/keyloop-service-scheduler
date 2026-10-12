import { listAppointmentsOptions, listAppointmentsQueryKey } from "@/api/@tanstack/react-query.gen"
import type { Options } from "@/api/sdk.gen"
import type { AppointmentListItemResponse, ListAppointmentsData } from "@/api/types.gen"
import { shiftDate } from "@/lib/calendar-date"

/**
 * The range read (`GET /dealerships/{id}/appointments?from=&to=`, ARCHITECTURE §8.7): one dealership's appointments whose
 * local start date falls in [from, to], every status, ordered by start. The Overview and the Calendar read it; the
 * dispatch board and the Appointments list read one day's schedule instead.
 */

/** The longest range the API answers, counting both bounds (a longer one is a `400`). */
export const MAX_RANGE_DAYS = 62

/** Every calendar date from `from` to `to`, both included (`yyyy-MM-dd`, the dealership's own calendar). */
export function datesFrom(from: string, to: string): string[] {
  const dates: string[] = []
  for (let date = from; date <= to; date = shiftDate(date, 1)) dates.push(date)
  return dates
}

/** The query options of one range read, with no status filter: a page sorts statuses out itself. */
export function rangeReadOptions(dealershipId: string, from: string, to: string) {
  const days = datesFrom(from, to).length
  if (days > MAX_RANGE_DAYS) throw new RangeError(`A range read covers at most ${MAX_RANGE_DAYS} days; ${from} to ${to} is ${days}.`)
  return listAppointmentsOptions({ path: { dealershipId }, query: { from, to } as ListAppointmentsData["query"] })
}

/**
 * Every range read of one dealership, whatever its dates: the generated key without its `query` part, which TanStack Query
 * matches as a partial key. A booking or a cancellation at that dealership marks them all stale.
 */
export function rangeReadsOf(dealershipId: string) {
  return listAppointmentsQueryKey({ path: { dealershipId } } as Options<ListAppointmentsData>)
}

/** The local date an appointment starts on (`2026-10-13T09:00+01:00` → `2026-10-13`): its day on the dealership's calendar. */
export function localDateOf(appointment: Pick<AppointmentListItemResponse, "startLocal">): string {
  return appointment.startLocal.slice(0, 10)
}

/** Appointments by local date, in date order, each day's in start order. */
export function byLocalDate<T extends Pick<AppointmentListItemResponse, "startLocal" | "startUtc" | "id">>(appointments: readonly T[]): Map<string, T[]> {
  const sorted = [...appointments].sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc) || a.id.localeCompare(b.id))
  const days = new Map<string, T[]>()
  for (const date of [...new Set(sorted.map(localDateOf))].sort()) days.set(date, [])
  for (const appointment of sorted) days.get(localDateOf(appointment))!.push(appointment)
  return days
}
