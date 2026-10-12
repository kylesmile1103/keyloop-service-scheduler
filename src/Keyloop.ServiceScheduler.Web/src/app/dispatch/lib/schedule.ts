import type {
  BayCapability,
  Certification,
  ResourceSummary,
  ScheduledAppointmentResponse,
  WorkshopScheduleResponse,
} from "@/api/types.gen"
import { bookedMinutes, windowMinutes } from "@/lib/booked-time"
import { todayIn } from "@/lib/calendar-date"
import { shownWarning } from "@/lib/competence-warnings"

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

/**
 * The lanes as a caller may see them: a competence warning stays only for a signed-in workshop role (`shownWarning`), so a
 * visitor's board never marks one, even from an answer read before they signed out.
 */
export function withVisibleWarnings(lanes: readonly Lane[], canSee: boolean): Lane[] {
  return lanes.map((lane) => ({
    ...lane,
    appointments: lane.appointments.map((appointment) => {
      const warning = shownWarning(appointment.competenceWarning, canSee)
      return warning === (appointment.competenceWarning ?? null) ? appointment : { ...appointment, competenceWarning: warning }
    }),
  }))
}

/** How many appointments on the lanes are flagged for review, each counted once (a technician lane repeats no bay's). */
export function reviewCount(lanes: readonly Lane[]): number {
  return new Set(lanes.flatMap((lane) => lane.appointments.filter((appointment) => appointment.competenceWarning).map((appointment) => appointment.id))).size
}

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

/** The KPI strip's figures, computed from the schedule alone (Addendum B §B4). */
export function scheduleKpis(schedule: WorkshopScheduleResponse, now: Date): ScheduleKpis {
  const appointments = boardAppointments(schedule)
  const window = schedule.operatingWindow
  if (!window) return { appointments: appointments.length, utilisation: null, busyNow: null }

  const activeBays = schedule.bays.filter((bay) => bay.isActive)
  const utilisation = {
    bookedMinutes: bookedMinutes(activeBays.flatMap((bay) => bay.appointments), window),
    capacityMinutes: activeBays.length * windowMinutes(window),
  }

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
