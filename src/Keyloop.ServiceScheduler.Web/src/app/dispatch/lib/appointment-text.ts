import { formatLocalTime } from "./time-grid"
import type { BoardAppointment } from "./schedule"
import { statusMeta } from "./status"

/** "08:00–09:00" on the dealership's clock. */
export function timeRange(appointment: Pick<BoardAppointment, "startUtc" | "endUtc">, timeZone: string): string {
  return `${formatLocalTime(appointment.startUtc, timeZone)}–${formatLocalTime(appointment.endUtc, timeZone)}`
}

/**
 * What a block or card says to assistive technology (Addendum B §B4):
 * "Interim Service, Bay 1 - Standard, 08:00 to 09:00, Amelia Clarke, Confirmed".
 */
export function appointmentLabel(appointment: BoardAppointment, timeZone: string): string {
  const start = formatLocalTime(appointment.startUtc, timeZone)
  const end = formatLocalTime(appointment.endUtc, timeZone)
  return [appointment.serviceType.name, appointment.bay.name, `${start} to ${end}`, appointment.technician.name, statusMeta[appointment.status].label].join(
    ", "
  )
}

/**
 * What a job card says to assistive technology (DESIGN_SYSTEM 11.13): the block's words plus the customer, whom the card
 * shows: "Interim Service, Bay 1 - Standard, 08:00 to 09:00, Sophie Turner, Amelia Clarke, Confirmed".
 */
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
  ].join(", ")
}

/** Initials for an avatar: first and last name ("Amelia Clarke" → "AC"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words
  return letters.map((word) => word.charAt(0).toUpperCase()).join("")
}

/** The first word of a name ("Amelia Clarke" → "Amelia"). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}
