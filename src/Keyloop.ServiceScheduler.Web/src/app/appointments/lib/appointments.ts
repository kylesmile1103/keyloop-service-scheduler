import type { AppointmentStatus, ServiceTypeSummary, WorkshopScheduleResponse } from "@/api/types.gen"
import { localTime } from "@/app/dispatch/lib/appointment-text"
import { boardAppointments, type BoardAppointment } from "@/app/dispatch/lib/schedule"
import { activeStatuses, boardStatuses, statusMeta } from "@/app/dispatch/lib/status"
import type { FacetOption } from "@/components/data-table/data-table-faceted-filter"
import type { Noun } from "@/lib/data-table"

export type AppointmentRow = BoardAppointment

export const APPOINTMENTS: Noun = { one: "appointment", other: "appointments" }

export const APPOINTMENT_SEARCH = { label: "Search appointments", placeholder: "Customer, registration or VIN" }

export type FacetId = "status" | "bay" | "technician" | "service"

export const FACETS: ReadonlyArray<{ id: FacetId; title: string }> = [
  { id: "status", title: "Status" },
  { id: "bay", title: "Bay" },
  { id: "technician", title: "Technician" },
  { id: "service", title: "Service" },
]

/** Flattens a day's workshop schedule into appointments sorted by start time. */
export function appointmentRows(schedule: WorkshopScheduleResponse): AppointmentRow[] {
  return boardAppointments(schedule).sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc))
}

export function durationMinutes(row: Pick<AppointmentRow, "startUtc" | "endUtc">): number {
  return Math.round((Date.parse(row.endUtc) - Date.parse(row.startUtc)) / 60_000)
}

export function rowName(row: AppointmentRow): string {
  return `${row.serviceType.name} at ${localTime(row.startLocal)}, ${row.customerName}`
}

const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, "")

/** Matches an appointment against a search query by customer name, registration, or VIN. */
export function matchesSearch(row: AppointmentRow, query: string): boolean {
  const wanted = normalise(query)
  if (!wanted) return true
  return [row.customerName, row.registration, row.vin].some((field) => normalise(field).includes(wanted))
}

export function matchesFacet(value: string, selected: readonly string[] | undefined): boolean {
  return !selected || selected.length === 0 || selected.includes(value)
}

const byLabel = (a: FacetOption, b: FacetOption) => a.label.localeCompare(b.label, "en-GB")

/** Builds faceted filter options for statuses, bays, technicians, and services. */
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
  total: number
  active: number
  completed: number
  noShows: number
}

/** Computes summary counts across the day's appointments. */
export function appointmentStats(rows: readonly AppointmentRow[]): AppointmentStats {
  const count = (statuses: readonly AppointmentStatus[]) => rows.filter((row) => statuses.includes(row.status)).length
  return { total: rows.length, active: count(activeStatuses), completed: count(["Completed"]), noShows: count(["NoShow"]) }
}
