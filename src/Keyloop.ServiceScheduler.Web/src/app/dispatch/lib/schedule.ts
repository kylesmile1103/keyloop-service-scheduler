import type {
  BayCapability,
  Certification,
  ResourceSummary,
  ScheduledAppointmentResponse,
  WorkshopScheduleResponse,
} from "@/api/types.gen"

import { todayIn } from "./calendar-date"
import { activeStatuses } from "./status"

/** Which resources are the board's rows: the bays (the default) or the technicians. */
export type LaneMode = "bays" | "technicians"

/** An appointment on the board, with the bay it is in (the schedule nests appointments under their bay). */
export interface BoardAppointment extends ScheduledAppointmentResponse {
  bay: ResourceSummary
}

/** One row of the board. */
export interface Lane {
  id: string
  name: string
  kind: LaneMode
  /** False for a bay out of service or a technician taking no new bookings: the lane stays, with what it already holds. */
  isActive: boolean
  /** A technician's employee number. */
  detail?: string
  capabilities?: BayCapability[]
  certifications?: Certification[]
  /** By start time. */
  appointments: BoardAppointment[]
}

const byStart = (a: BoardAppointment, b: BoardAppointment) => Date.parse(a.startUtc) - Date.parse(b.startUtc)

/** Every appointment on the board, each knowing its bay. */
export function boardAppointments(schedule: WorkshopScheduleResponse): BoardAppointment[] {
  return schedule.bays.flatMap((bay) =>
    bay.appointments.map((appointment) => ({ ...appointment, bay: { id: bay.id, name: bay.name } }))
  )
}

/** The board's rows in the API's order (by name): one per bay, or one per technician gathering their work from every bay. */
export function buildLanes(schedule: WorkshopScheduleResponse, mode: LaneMode): Lane[] {
  if (mode === "bays") {
    return schedule.bays.map((bay) => ({
      id: bay.id,
      name: bay.name,
      kind: "bays",
      isActive: bay.isActive,
      capabilities: bay.capabilities,
      appointments: bay.appointments.map((appointment) => ({ ...appointment, bay: { id: bay.id, name: bay.name } })).sort(byStart),
    }))
  }
  const all = boardAppointments(schedule)
  return schedule.technicians.map((technician) => ({
    id: technician.id,
    name: technician.name,
    kind: "technicians",
    isActive: technician.isActive,
    detail: technician.employeeNumber,
    certifications: technician.certifications,
    appointments: all.filter((appointment) => appointment.technician.id === technician.id).sort(byStart),
  }))
}

export interface ScheduleKpis {
  /** Appointments on the board that day (cancelled ones are not on it). */
  appointments: number
  /** Booked minutes on active bays over the active bays' opening minutes; `null` on a closed day. */
  utilisation: { bookedMinutes: number; capacityMinutes: number } | null
  /** Active technicians with a job holding them at this moment; `null` unless the board shows today and the workshop opens. */
  busyNow: { busy: number; active: number } | null
}

/** Statuses whose minutes count as booked bay time: a no-show never used the bay. */
const occupying = new Set(["Confirmed", "CheckedIn", "InProgress", "Completed"])

/** The KPI strip's figures, computed from the schedule alone (Addendum B §B4). */
export function scheduleKpis(schedule: WorkshopScheduleResponse, now: Date): ScheduleKpis {
  const appointments = boardAppointments(schedule)
  const window = schedule.operatingWindow
  if (!window) return { appointments: appointments.length, utilisation: null, busyNow: null }

  const opens = Date.parse(window.startUtc)
  const closes = Date.parse(window.endUtc)
  const minutes = (from: number, to: number) => Math.max(0, Math.min(to, closes) - Math.max(from, opens)) / 60_000

  const activeBays = schedule.bays.filter((bay) => bay.isActive)
  const bookedMinutes = activeBays
    .flatMap((bay) => bay.appointments)
    .filter((appointment) => occupying.has(appointment.status))
    .reduce((total, appointment) => total + minutes(Date.parse(appointment.startUtc), Date.parse(appointment.endUtc)), 0)
  const utilisation = { bookedMinutes, capacityMinutes: activeBays.length * minutes(opens, closes) }

  let busyNow: ScheduleKpis["busyNow"] = null
  if (todayIn(schedule.dealership.timeZoneId, now) === schedule.date) {
    const instant = now.getTime()
    const working = new Set(
      appointments
        .filter(
          (appointment) =>
            activeStatuses.includes(appointment.status) &&
            Date.parse(appointment.startUtc) <= instant &&
            instant < Date.parse(appointment.endUtc)
        )
        .map((appointment) => appointment.technician.id)
    )
    const active = schedule.technicians.filter((technician) => technician.isActive)
    busyNow = { busy: active.filter((technician) => working.has(technician.id)).length, active: active.length }
  }

  return { appointments: appointments.length, utilisation, busyNow }
}
