import { formatLocalTime } from "@/lib/local-time"

import type { BoardAppointment } from "./schedule"
import { statusMeta } from "./status"

/** "08:00–09:00" on the dealership's clock. */
export function timeRange(appointment: Pick<BoardAppointment, "startUtc" | "endUtc">, timeZone: string): string {
  return `${formatLocalTime(appointment.startUtc, timeZone)}–${formatLocalTime(appointment.endUtc, timeZone)}`
}

/** Accessible label for a timeline appointment block. */
export function appointmentLabel(appointment: BoardAppointment, timeZone: string): string {
  const start = formatLocalTime(appointment.startUtc, timeZone)
  const end = formatLocalTime(appointment.endUtc, timeZone)
  return [
    appointment.serviceType.name,
    appointment.bay.name,
    `${start} to ${end}`,
    appointment.technician.name,
    statusMeta[appointment.status].label,
    ...reviewWords(appointment),
  ].join(", ")
}

/** "needs review" at the end of a label, for an appointment the board shows flagged (its warning is kept only for a role). */
const reviewWords = (appointment: Pick<BoardAppointment, "competenceWarning">) => (appointment.competenceWarning ? ["needs review"] : [])

/** Accessible label for an agenda job card, including the customer name. */
export function jobCardLabel(appointment: BoardAppointment, timeZone: string): string {
  const start = formatLocalTime(appointment.startUtc, timeZone)
  const end = formatLocalTime(appointment.endUtc, timeZone)
  return [
    appointment.serviceType.name,
    appointment.bay.name,
    `${start} to ${end}`,
    appointment.customerName,
    appointment.technician.name,
    statusMeta[appointment.status].label,
    ...reviewWords(appointment),
  ].join(", ")
}

/** The first word of a name ("Amelia Clarke" → "Amelia"). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

/** The wall-clock time of a `…Local` value as the API writes it (`2026-10-13T10:15+01:00` → `10:15`). */
export function localTime(local: string): string {
  return local.slice(11, 16)
}
