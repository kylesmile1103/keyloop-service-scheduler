import type { AppointmentStatus, OperatingWindowResponse } from "@/api/types.gen"

/** An appointment's time, as the schedule writes it (UTC instants, the end exclusive). */
interface Booked {
  startUtc: string
  endUtc: string
  status: AppointmentStatus
}

/** Statuses whose minutes count as booked time: a no-show never used the bay or the technician (cancelled ones are gone). */
export const occupyingStatuses: ReadonlySet<AppointmentStatus> = new Set<AppointmentStatus>([
  "Confirmed",
  "CheckedIn",
  "InProgress",
  "Completed",
])

/** The opening window's length in minutes. */
export function windowMinutes(window: Pick<OperatingWindowResponse, "startUtc" | "endUtc">): number {
  return Math.max(0, Date.parse(window.endUtc) - Date.parse(window.startUtc)) / 60_000
}

/**
 * The booked minutes of these appointments inside the opening window: the occupying statuses only, each clipped to the
 * window. The dispatch board's bay utilisation and the resources pages' figures are this one sum.
 */
export function bookedMinutes(appointments: readonly Booked[], window: Pick<OperatingWindowResponse, "startUtc" | "endUtc">): number {
  const opens = Date.parse(window.startUtc)
  const closes = Date.parse(window.endUtc)
  return appointments
    .filter((appointment) => occupyingStatuses.has(appointment.status))
    .reduce(
      (total, appointment) =>
        total + Math.max(0, Math.min(Date.parse(appointment.endUtc), closes) - Math.max(Date.parse(appointment.startUtc), opens)) / 60_000,
      0
    )
}
