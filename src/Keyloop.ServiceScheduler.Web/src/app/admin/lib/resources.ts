import type {
  AdminBayResponse,
  AdminTechnicianResponse,
  BayCapability,
  BayScheduleResponse,
  Certification,
  ScheduledAppointmentResponse,
  ServiceTypeResponse,
  TechnicianResponse,
  WorkshopScheduleResponse,
} from "@/api/types.gen"
import { bookedMinutes, windowMinutes } from "@/lib/booked-time"

/** A resource's day: the work the day's schedule lists for it, measured as the dispatch board measures it. */
export interface DayLoad {
  /** Appointments on the day's schedule (cancelled ones are not on it). */
  appointments: number
  /** Booked minutes inside the opening hours; a no-show used no time (lib/booked-time). */
  bookedMinutes: number
  /** The opening hours that day in minutes; `null` when the dealership is closed. */
  windowMinutes: number | null
}

/**
 * A technician of the roster, with today's work. For an Admin (Task 30b) it is the Admin read, with the `version` an edit
 * is sent against (`If-Match`) and every competence field; for any other role, the schedule's row (no version).
 */
export interface TechnicianRecord extends TechnicianResponse {
  today: DayLoad
  version?: number
}

/** A service bay, with today's work (the appointments themselves stay on the board); an Admin's has its `version`. */
export interface BayRecord extends Omit<BayScheduleResponse, "appointments"> {
  today: DayLoad
  version?: number
}

/** Why the dealership cannot book a service, from what its active bays and technicians have. */
export interface Shortfall {
  /** Required capabilities no active bay has. */
  capabilities: BayCapability[]
  /** Required certifications no active technician holds. */
  certifications: Certification[]
  /** Every required capability is on some active bay, but no one bay has them all. */
  splitAcrossBays: boolean
  /** Every required certification is held by some active technician, but no one technician holds them all. */
  splitAcrossTechnicians: boolean
}

/** A service of the catalogue, with today's bookings and, when the dealership cannot book it, why. */
export interface ServiceRecord extends ServiceTypeResponse {
  /** Today's appointments for this service. */
  bookedToday: number
  /** `null` when the service is bookable here. */
  shortfall: Shortfall | null
}

function dayLoad(schedule: WorkshopScheduleResponse, work: readonly ScheduledAppointmentResponse[]): DayLoad {
  const window = schedule.operatingWindow
  return {
    appointments: work.length,
    bookedMinutes: window ? bookedMinutes(work, window) : 0,
    windowMinutes: window ? windowMinutes(window) : null,
  }
}

const allAppointments = (schedule: WorkshopScheduleResponse) => schedule.bays.flatMap((bay) => bay.appointments)

/** The roster as the schedule lists it (by name, active or not), each technician with the work they hold in every bay today. */
export function technicianRecords(schedule: WorkshopScheduleResponse): TechnicianRecord[] {
  const work = allAppointments(schedule)
  return schedule.technicians.map((technician) => ({
    ...technician,
    today: dayLoad(schedule, work.filter((appointment) => appointment.technician.id === technician.id)),
  }))
}

/**
 * The roster as the Admin reads it (by name, with versions and every competence field), each technician with the work the
 * day's schedule lists for them (none when the schedule does not list them).
 */
export function adminTechnicianRecords(people: readonly AdminTechnicianResponse[], schedule: WorkshopScheduleResponse): TechnicianRecord[] {
  const work = allAppointments(schedule)
  return [...people]
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB"))
    .map((technician) => ({
      ...technician,
      today: dayLoad(schedule, work.filter((appointment) => appointment.technician.id === technician.id)),
    }))
}

/** The bays as the Admin reads them, each with the work it holds on the day's schedule. */
export function adminBayRecords(lanes: readonly AdminBayResponse[], schedule: WorkshopScheduleResponse): BayRecord[] {
  return [...lanes]
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB", { numeric: true }))
    .map((bay) => ({
      ...bay,
      today: dayLoad(schedule, schedule.bays.find((candidate) => candidate.id === bay.id)?.appointments ?? []),
    }))
}

/** The bays as the schedule lists them (by name, in service or not), each with the work it holds today. */
export function bayRecords(schedule: WorkshopScheduleResponse): BayRecord[] {
  return schedule.bays.map(({ appointments, ...bay }) => ({ ...bay, today: dayLoad(schedule, appointments) }))
}

/**
 * The catalogue (the API's order, by name) with each service's appointments today. For a service the dealership cannot
 * book (the API's `bookable`), what is missing: the required capabilities no active bay has and the certifications no
 * active technician holds, as the booking's `422 no-qualified-resources` names them.
 */
export function serviceRecords(catalogue: readonly ServiceTypeResponse[], schedule: WorkshopScheduleResponse): ServiceRecord[] {
  const work = allAppointments(schedule)
  const activeBays = schedule.bays.filter((bay) => bay.isActive)
  const activeTechnicians = schedule.technicians.filter((technician) => technician.isActive)
  return catalogue.map((service) => ({
    ...service,
    bookedToday: work.filter((appointment) => appointment.serviceType.id === service.id).length,
    shortfall: service.bookable ? null : shortfallOf(service, activeBays, activeTechnicians),
  }))
}

function shortfallOf(
  service: ServiceTypeResponse,
  bays: readonly BayScheduleResponse[],
  technicians: readonly TechnicianResponse[]
): Shortfall {
  const capabilities = service.requiredBayCapabilities.filter((capability) => !bays.some((bay) => bay.capabilities.includes(capability)))
  const certifications = service.requiredCertifications.filter(
    (certification) => !technicians.some((technician) => technician.certifications.includes(certification))
  )
  const oneBay = bays.some((bay) => service.requiredBayCapabilities.every((capability) => bay.capabilities.includes(capability)))
  const oneTechnician = technicians.some((technician) =>
    service.requiredCertifications.every((certification) => technician.certifications.includes(certification))
  )
  return {
    capabilities,
    certifications,
    splitAcrossBays: capabilities.length === 0 && !oneBay,
    splitAcrossTechnicians: certifications.length === 0 && !oneTechnician,
  }
}

/** "Not all on one technician": a shortfall that is not a missing need but a split one, in words; `null` otherwise. */
export function splitSentence(shortfall: Shortfall): string | null {
  if (shortfall.splitAcrossBays && shortfall.splitAcrossTechnicians) return "Not all on one bay or technician"
  if (shortfall.splitAcrossBays) return "Not all on one bay"
  if (shortfall.splitAcrossTechnicians) return "Not all on one technician"
  return null
}

/**
 * The day a list's figures are measured on: whether the dealership opens, and for how long, is the day's own (its opening
 * window), never inferred from the rows, so a dealership with no technicians or bays yet is still open.
 */
type FiguresDay = Pick<WorkshopScheduleResponse, "operatingWindow">

/** The day's opening hours in minutes; `null` when the dealership is closed. */
const openMinutes = ({ operatingWindow }: FiguresDay) => (operatingWindow ? windowMinutes(operatingWindow) : null)

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

export interface TechnicianFigures {
  total: number
  active: number
  /** Active technicians with at least one appointment today. */
  working: number
  /** The active technicians' appointments today: those `bookedMinutes` is measured across. */
  appointments: number
  /** Booked minutes of the active technicians. */
  bookedMinutes: number
  /** Active technicians times the opening hours: `0` when none is active, `null` only on a closed day. */
  capacityMinutes: number | null
}

/** The Technicians page's figures for `day`, the day the records were read for. */
export function technicianFigures(records: readonly TechnicianRecord[], day: FiguresDay): TechnicianFigures {
  const active = records.filter((record) => record.isActive)
  const open = openMinutes(day)
  return {
    total: records.length,
    active: active.length,
    working: active.filter((record) => record.today.appointments > 0).length,
    appointments: sum(active.map((record) => record.today.appointments)),
    bookedMinutes: sum(active.map((record) => record.today.bookedMinutes)),
    capacityMinutes: open === null ? null : active.length * open,
  }
}

export interface BayFigures {
  total: number
  inService: number
  /** Bays in service with at least one appointment today. */
  inUse: number
  /** The appointments in the bays in service today: those `bookedMinutes` is measured across. */
  appointments: number
  /** Booked minutes of the bays in service: the board's bay utilisation, over `capacityMinutes`. */
  bookedMinutes: number
  /** Bays in service times the opening hours: `0` when none is in service, `null` only on a closed day. */
  capacityMinutes: number | null
}

/** The Bays page's figures for `day`, the day the records were read for; booked over capacity is the board's bay utilisation. */
export function bayFigures(records: readonly BayRecord[], day: FiguresDay): BayFigures {
  const inService = records.filter((record) => record.isActive)
  const open = openMinutes(day)
  return {
    total: records.length,
    inService: inService.length,
    inUse: inService.filter((record) => record.today.appointments > 0).length,
    appointments: sum(inService.map((record) => record.today.appointments)),
    bookedMinutes: sum(inService.map((record) => record.today.bookedMinutes)),
    capacityMinutes: open === null ? null : inService.length * open,
  }
}

export interface ServiceFigures {
  total: number
  bookable: number
  /** Today's appointments across the catalogue. */
  bookedToday: number
  /** Services with at least one appointment today. */
  servicesBookedToday: number
  shortestMinutes: number | null
  longestMinutes: number | null
}

/** The Services page's figures. */
export function serviceFigures(records: readonly ServiceRecord[]): ServiceFigures {
  const durations = records.map((record) => record.durationMinutes)
  return {
    total: records.length,
    bookable: records.filter((record) => record.bookable).length,
    bookedToday: sum(records.map((record) => record.bookedToday)),
    servicesBookedToday: records.filter((record) => record.bookedToday > 0).length,
    shortestMinutes: durations.length > 0 ? Math.min(...durations) : null,
    longestMinutes: durations.length > 0 ? Math.max(...durations) : null,
  }
}

/** 0 → "0 min", 45 → "45 min", 60 → "1 h", 135 → "2 h 15 min". */
export function formatMinutes(minutes: number): string {
  const whole = Math.round(minutes)
  const hours = Math.floor(whole / 60)
  const rest = whole % 60
  if (hours === 0) return `${rest} min`
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/** Lower case without white space, so "T-1001", "t-10 01" and "T 1001" compare alike where it matters. */
const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, "")

/** A list's search: any of the fields contains what was typed, ignoring case and spaces. A blank search keeps all. */
export function matchesSearch(fields: readonly string[], query: string): boolean {
  const wanted = normalise(query)
  if (!wanted) return true
  return fields.some((field) => normalise(field).includes(wanted))
}
