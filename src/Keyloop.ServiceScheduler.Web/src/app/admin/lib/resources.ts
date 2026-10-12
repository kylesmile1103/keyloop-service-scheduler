import type {
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

/** A technician of the roster, with today's work. */
export interface TechnicianRecord extends TechnicianResponse {
  today: DayLoad
}

/** A service bay, with today's work (the appointments themselves stay on the board). */
export interface BayRecord extends Omit<BayScheduleResponse, "appointments"> {
  today: DayLoad
}

/** What a service needs that no active bay has, and no active technician holds. Both empty: no single bay or technician has the whole set. */
export interface Shortfall {
  capabilities: BayCapability[]
  certifications: Certification[]
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
    shortfall: service.bookable
      ? null
      : {
          capabilities: service.requiredBayCapabilities.filter((capability) => !activeBays.some((bay) => bay.capabilities.includes(capability))),
          certifications: service.requiredCertifications.filter(
            (certification) => !activeTechnicians.some((technician) => technician.certifications.includes(certification))
          ),
        },
  }))
}

/** The window minutes of a set of records' day (all records of one list share it); `null` on a closed day or an empty list. */
const windowOf = (records: ReadonlyArray<{ today: DayLoad }>) => records.find((record) => record.today.windowMinutes !== null)?.today.windowMinutes ?? null

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

export interface TechnicianFigures {
  total: number
  active: number
  /** Active technicians with at least one appointment today. */
  working: number
  appointments: number
  /** Booked minutes of the active technicians. */
  bookedMinutes: number
  /** Active technicians times the opening hours; `null` on a closed day. */
  capacityMinutes: number | null
}

/** The Technicians page's figures for today. */
export function technicianFigures(records: readonly TechnicianRecord[]): TechnicianFigures {
  const active = records.filter((record) => record.isActive)
  const window = windowOf(records)
  return {
    total: records.length,
    active: active.length,
    working: active.filter((record) => record.today.appointments > 0).length,
    appointments: sum(records.map((record) => record.today.appointments)),
    bookedMinutes: sum(active.map((record) => record.today.bookedMinutes)),
    capacityMinutes: window === null ? null : active.length * window,
  }
}

export interface BayFigures {
  total: number
  inService: number
  /** Bays in service with at least one appointment today. */
  inUse: number
  appointments: number
  /** Booked minutes of the bays in service: the board's bay utilisation, over `capacityMinutes`. */
  bookedMinutes: number
  /** Bays in service times the opening hours; `null` on a closed day. */
  capacityMinutes: number | null
}

/** The Bays page's figures for today; booked over capacity is the dispatch board's bay utilisation. */
export function bayFigures(records: readonly BayRecord[]): BayFigures {
  const inService = records.filter((record) => record.isActive)
  const window = windowOf(records)
  return {
    total: records.length,
    inService: inService.length,
    inUse: inService.filter((record) => record.today.appointments > 0).length,
    appointments: sum(records.map((record) => record.today.appointments)),
    bookedMinutes: sum(inService.map((record) => record.today.bookedMinutes)),
    capacityMinutes: window === null ? null : inService.length * window,
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
