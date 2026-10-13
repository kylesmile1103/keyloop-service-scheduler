import { listAppointmentsOptions, listAppointmentsQueryKey } from "@/api/@tanstack/react-query.gen"
import type { Options } from "@/api/sdk.gen"
import type { AppointmentListItemResponse, ListAppointmentsData } from "@/api/types.gen"
import { shiftDate } from "@/lib/calendar-date"

/** Maximum inclusive day span accepted by `GET /dealerships/{id}/appointments`. */
export const MAX_RANGE_DAYS = 62

/** Returns all calendar dates from `from` to `to` inclusive (`yyyy-MM-dd`). */
export function datesFrom(from: string, to: string): string[] {
  const dates: string[] = []
  for (let date = from; date <= to; date = shiftDate(date, 1)) dates.push(date)
  return dates
}

/** Query options for reading a dealership's appointments across `[from, to]`. */
export function rangeReadOptions(dealershipId: string, from: string, to: string) {
  const days = datesFrom(from, to).length
  if (days > MAX_RANGE_DAYS) throw new RangeError(`A range read covers at most ${MAX_RANGE_DAYS} days; ${from} to ${to} is ${days}.`)
  return listAppointmentsOptions({ path: { dealershipId }, query: { from, to } as ListAppointmentsData["query"] })
}

/** Partial query key matching all appointment range queries for `dealershipId`. */
export function rangeReadsOf(dealershipId: string) {
  return listAppointmentsQueryKey({ path: { dealershipId } } as Options<ListAppointmentsData>)
}

/** Extracts the dealership-local calendar date (`yyyy-MM-dd`) from `startLocal`. */
export function localDateOf(appointment: Pick<AppointmentListItemResponse, "startLocal">): string {
  return appointment.startLocal.slice(0, 10)
}

/** Groups appointments by local start date, ordered by date and start time. */
export function byLocalDate<T extends Pick<AppointmentListItemResponse, "startLocal" | "startUtc" | "id">>(appointments: readonly T[]): Map<string, T[]> {
  const sorted = [...appointments].sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc) || a.id.localeCompare(b.id))
  const days = new Map<string, T[]>()
  for (const date of [...new Set(sorted.map(localDateOf))].sort()) days.set(date, [])
  for (const appointment of sorted) days.get(localDateOf(appointment))!.push(appointment)
  return days
}
