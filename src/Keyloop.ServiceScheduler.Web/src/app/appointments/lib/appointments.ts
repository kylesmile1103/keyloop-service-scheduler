import type { AppointmentStatus, ServiceTypeSummary, WorkshopScheduleResponse } from "@/api/types.gen"
import { localTime } from "@/app/dispatch/lib/appointment-text"
import { boardAppointments, type BoardAppointment } from "@/app/dispatch/lib/schedule"
import { activeStatuses, boardStatuses, statusMeta } from "@/app/dispatch/lib/status"
import type { FacetOption } from "@/components/data-table/data-table-faceted-filter"
import type { Noun } from "@/lib/data-table"

/** One row of the appointments list: an appointment from the day's schedule, knowing the bay it is in. */
export type AppointmentRow = BoardAppointment

/** What the list holds, for its counts. */
export const APPOINTMENTS: Noun = { one: "appointment", other: "appointments" }

/** The list's search box: what it is called and what it searches. */
export const APPOINTMENT_SEARCH = { label: "Search appointments", placeholder: "Customer, registration or VIN" }

/** The list's faceted filters, by column id. */
export type FacetId = "status" | "bay" | "technician" | "service"

/** The faceted filters, in the order the toolbar and the phone's filter sheet show them. */
export const FACETS: ReadonlyArray<{ id: FacetId; title: string }> = [
  { id: "status", title: "Status" },
  { id: "bay", title: "Bay" },
  { id: "technician", title: "Technician" },
  { id: "service", title: "Service" },
]

/**
 * The day's appointments as one list, by start time. It is the board's data (`GET /schedule`, the bays flattened); the
 * schedule lists bays by name and each bay's work by start, so appointments that start together keep the bays' order.
 * Cancelled appointments are not in the schedule, so they never appear here either.
 */
export function appointmentRows(schedule: WorkshopScheduleResponse): AppointmentRow[] {
  // Array.prototype.sort is stable: equal starts keep the bay order boardAppointments gives them.
  return boardAppointments(schedule).sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc))
}

/** The booked time, from start to end, in minutes. */
export function durationMinutes(row: Pick<AppointmentRow, "startUtc" | "endUtc">): number {
  return Math.round((Date.parse(row.endUtc) - Date.parse(row.startUtc)) / 60_000)
}

/** "Interim Service at 08:00, Sophie Turner": which appointment a row (and its actions) stands for. */
export function rowName(row: AppointmentRow): string {
  return `${row.serviceType.name} at ${localTime(row.startLocal)}, ${row.customerName}`
}

/** Lower case without white space, so "RE21 KLM", "re21klm" and "re 21" compare alike. */
const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, "")

/**
 * The list's search: the customer's name, the registration or the VIN contains what was typed, ignoring case and spaces.
 * Service, bay and technician have faceted filters of their own, so the search leaves them out. A blank search keeps all.
 */
export function matchesSearch(row: AppointmentRow, query: string): boolean {
  const wanted = normalise(query)
  if (!wanted) return true
  return [row.customerName, row.registration, row.vin].some((field) => normalise(field).includes(wanted))
}

/** A faceted filter: the value is one of those chosen, or nothing is chosen. */
export function matchesFacet(value: string, selected: readonly string[] | undefined): boolean {
  return !selected || selected.length === 0 || selected.includes(value)
}

const byLabel = (a: FacetOption, b: FacetOption) => a.label.localeCompare(b.label, "en-GB")

/**
 * The choices of each faceted filter for a dealership's day. Statuses, bays and technicians are the whole sets (statuses in
 * lifecycle order, bays and technicians as the API lists them), so a choice does not vanish when another day has nothing
 * booked against it. Services come from the catalogue once it is known, plus any the day's appointments name.
 */
export function filterOptions(
  schedule: WorkshopScheduleResponse,
  catalogue: readonly ServiceTypeSummary[] = []
): Record<FacetId, FacetOption[]> {
  const services = new Map<string, FacetOption>()
  for (const service of [...catalogue, ...appointmentRows(schedule).map((row) => row.serviceType)]) {
    services.set(service.id, { value: service.id, label: service.name })
  }

  return {
    status: boardStatuses.map((status) => ({ value: status, label: statusMeta[status].label })),
    bay: schedule.bays.map((bay) => ({ value: bay.id, label: bay.name })),
    technician: schedule.technicians.map((technician) => ({ value: technician.id, label: technician.name })),
    service: [...services.values()].sort(byLabel),
  }
}

export interface AppointmentStats {
  /** Appointments on the list that day. */
  total: number
  /** Confirmed, checked in or in progress: work still holding its bay and technician. */
  active: number
  completed: number
  noShows: number
}

/** The figures above the list, for the whole day (the filters do not change them). */
export function appointmentStats(rows: readonly AppointmentRow[]): AppointmentStats {
  const count = (statuses: readonly AppointmentStatus[]) => rows.filter((row) => statuses.includes(row.status)).length
  return { total: rows.length, active: count(activeStatuses), completed: count(["Completed"]), noShows: count(["NoShow"]) }
}
