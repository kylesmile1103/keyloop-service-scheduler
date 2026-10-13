import type { AppointmentStatus, OperatingWindowResponse } from "@/api/types.gen"

interface Booked {
  startUtc: string
  endUtc: string
  status: AppointmentStatus
}

/** Statuses that count toward bay and technician utilisation. */
export const occupyingStatuses: ReadonlySet<AppointmentStatus> = new Set<AppointmentStatus>([
  "Confirmed",
  "CheckedIn",
  "InProgress",
  "Completed",
])

export function windowMinutes(window: Pick<OperatingWindowResponse, "startUtc" | "endUtc">): number {
  return Math.max(0, Date.parse(window.endUtc) - Date.parse(window.startUtc)) / 60_000
}

/** Total booked minutes of occupying appointments clipped to the operating window. */
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
