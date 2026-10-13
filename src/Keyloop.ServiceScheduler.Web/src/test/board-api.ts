import type {
  AppointmentListItemResponse,
  AppointmentResponse,
  AvailabilityResponse,
  BookAppointmentRequest,
  BookingTriageStatusResponse,
  CurrentUserResponse,
  DealershipResponse,
  FeatureSwitchesResponse,
  FindReturningCustomersRequest,
  ResolveVehicleProfileRequest,
  ReturningCustomerResponse,
  ScheduledAppointmentResponse,
  ServiceTypeResponse,
  TriageBookingRequest,
  TriageBookingResponse,
  WorkshopScheduleResponse,
  UploadBookingTriageImageRequest,
  UploadBookingTriageImageResponse,
  VehicleProfile,
} from "@/api/types.gen"
import { shiftDate } from "@/lib/calendar-date"
import { munich, reading } from "@/test/dealerships"
import { serviceAdvisor } from "@/test/identities"
import { jsonResponse, mockApi, problemResponse } from "@/test/mock-api"
import {
  bays,
  interimAvailability,
  interimDetails,
  interimServiceType,
  munichTuesday,
  readingSunday,
  readingTuesday,
  technicians,
} from "@/test/schedules"
import { triageDisabled, triageUnavailable } from "@/test/triage"
import { decodedVolkswagen, undecoded, vehicleAwareOff } from "@/test/vehicle"

type Answer<T> = T | Response | Promise<T | Response>

export interface BoardApiOptions {
  /** `GET /me`, the signed-in identity. By default: a Service advisor, who may view, book and cancel. */
  me?: () => Answer<CurrentUserResponse>
  dealerships?: () => Answer<DealershipResponse[]>
  /** The schedule for a dealership and date. By default: Reading's Tuesday (Sunday closed), München's Tuesday. */
  schedule?: (dealershipId: string, date: string) => Answer<WorkshopScheduleResponse>
  /**
   * `GET /dealerships/{id}/appointments?from=&to=` (the range read): the appointments whose local start date falls in
   * [from, to]. By default: every day's default schedule in the range (see `rangeFromSchedules`).
   */
  range?: (dealershipId: string, from: string, to: string, statuses: readonly string[]) => Answer<AppointmentListItemResponse[]>
  /** The dealership's catalogue. By default: Interim Service only. */
  serviceTypes?: (dealershipId: string) => Answer<ServiceTypeResponse[]>
  /** Free starts for a service on a date. By default: Interim Service's, whatever the service asked for. */
  availability?: (dealershipId: string, serviceTypeId: string, date: string) => Answer<AvailabilityResponse>
  appointment?: (appointmentId: string) => Answer<AppointmentResponse>
  cancel?: (appointmentId: string, body: { reason?: unknown }) => Answer<AppointmentResponse>
  /** POST a booking. By default: 201, in Bay 1 with Amelia Clarke (see `bookedFrom`). */
  book?: (dealershipId: string, body: BookAppointmentRequest, request: Request) => Answer<AppointmentResponse>
  /** GET the booking intake triage status. By default: suggestions off, as the API ships. */
  triageStatus?: () => Answer<BookingTriageStatusResponse>
  /** POST an intake description for suggestions. By default: 503 `triage-unavailable`, as the API answers when they are off. */
  triage?: (dealershipId: string, body: TriageBookingRequest) => Answer<TriageBookingResponse>
  uploadTriageImage?: (dealershipId: string, body: UploadBookingTriageImageRequest) => Answer<UploadBookingTriageImageResponse>
  /** `GET /features`, the environment's switches. By default: vehicle-aware requirements off, as every environment but Development and Demo. */
  features?: () => Answer<FeatureSwitchesResponse>
  /** POST a VIN to resolve. By default: Volkswagen for a WVW VIN, the manufacturer not known for any other. */
  resolveVehicle?: (body: ResolveVehicleProfileRequest) => Answer<VehicleProfile>
  /** POST a returning-customer search (`FindReturningCustomers`, Task 39). By default: nothing matches. */
  customerLookup?: (dealershipId: string, body: FindReturningCustomersRequest, request: Request) => Answer<ReturningCustomerResponse[]>
  /**
   * The Admin routes of Task 30a (technicians, bays, the requirement policy, the change history), answered by an
   * `adminServer` (src/test/admin-api.ts). Without one they are 404s, as on an API that has none.
   */
  admin?: { handle: (request: Request, url: URL) => Promise<Response | null> }
}

/** British Summer Time, as the fixtures' October dates are: a UTC instant as `yyyy-MM-ddTHH:mm+01:00`. */
const bstLocal = (utc: string) => `${new Date(Date.parse(utc) + 3_600_000).toISOString().slice(0, 16)}+01:00`

/** The appointment the API answers a booking with: the request's service, start and people, in the given bay. */
export function bookedFrom(
  body: BookAppointmentRequest,
  {
    id = "7b0c5a52-6f0e-4d2b-9a43-2c8a4b9f0e11",
    bay = bays.standard,
    technician = technicians.amelia,
    durationMinutes = 60,
    serviceName = "Interim Service",
  }: {
    id?: string
    bay?: { id: string; name: string }
    technician?: { id: string; name: string }
    durationMinutes?: number
    serviceName?: string
  } = {}
): AppointmentResponse {
  const endUtc = new Date(Date.parse(body.startUtc) + durationMinutes * 60_000).toISOString().replace(".000Z", "Z")
  return {
    ...interimDetails,
    id,
    serviceType: { id: body.serviceTypeId, code: "INTERIM-SERVICE", name: serviceName, durationMinutes },
    bay,
    technician,
    startUtc: body.startUtc,
    endUtc,
    startLocal: bstLocal(body.startUtc),
    endLocal: bstLocal(endUtc),
    status: "Confirmed",
    customer: body.customer,
    vehicle: {
      vin: body.vehicle.vin,
      registration: body.vehicle.registration,
      make: body.vehicle.make,
      model: body.vehicle.model,
    },
    notes: body.notes ?? null,
  }
}

/** A booked appointment as the schedule lists it under its bay. */
export function scheduledFrom(appointment: AppointmentResponse): ScheduledAppointmentResponse {
  return {
    id: appointment.id,
    startUtc: appointment.startUtc,
    endUtc: appointment.endUtc,
    startLocal: appointment.startLocal,
    endLocal: appointment.endLocal,
    status: appointment.status,
    serviceType: appointment.serviceType,
    technician: appointment.technician,
    vin: appointment.vehicle.vin,
    registration: appointment.vehicle.registration,
    customerName: appointment.customer.name,
  }
}

/**
 * A Tuesday fixture moved to another date: its window and appointments keep their local times on the new day. (The
 * fixtures' October dates are all before the clocks change on the 25th, so whole days keep the same offset.)
 */
function movedTo(schedule: WorkshopScheduleResponse, date: string): WorkshopScheduleResponse {
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${schedule.date}T00:00:00Z`)) / 86_400_000)
  if (days === 0) return schedule
  const utc = (instant: string) => new Date(Date.parse(instant) + days * 86_400_000).toISOString().replace(".000Z", "Z")
  const local = (value: string) => `${shiftDate(value.slice(0, 10), days)}${value.slice(10)}`
  return {
    ...schedule,
    date,
    operatingWindow: schedule.operatingWindow && {
      startUtc: utc(schedule.operatingWindow.startUtc),
      endUtc: utc(schedule.operatingWindow.endUtc),
      opensAtLocal: local(schedule.operatingWindow.opensAtLocal),
      closesAtLocal: local(schedule.operatingWindow.closesAtLocal),
    },
    bays: schedule.bays.map((bay) => ({
      ...bay,
      appointments: bay.appointments.map((appointment) => ({
        ...appointment,
        startUtc: utc(appointment.startUtc),
        endUtc: utc(appointment.endUtc),
        startLocal: local(appointment.startLocal),
        endLocal: local(appointment.endLocal),
      })),
    })),
  }
}

/** The default schedule: the fixture for the dealership, moved to the date asked (Reading is closed on Sundays). */
export function defaultSchedule(dealershipId: string, date: string): WorkshopScheduleResponse {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  if (dealershipId === munich.id) {
    // München closes at weekends.
    const closed = weekday === 0 || weekday === 6
    return closed ? { ...munichTuesday, date, operatingWindow: null } : movedTo(munichTuesday, date)
  }
  return weekday === 0 ? { ...readingSunday, date } : movedTo(readingTuesday, date)
}

/** A schedule's appointments as the range read lists them: each with its bay, ordered by start, then id. */
export function listItemsOf(schedule: WorkshopScheduleResponse): AppointmentListItemResponse[] {
  return schedule.bays
    .flatMap((bay) => bay.appointments.map((appointment) => ({ ...appointment, bay: { id: bay.id, name: bay.name } })))
    .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc) || a.id.localeCompare(b.id))
}

/**
 * The range read the default way: each day's default schedule from `from` to `to`, in order. The fixtures repeat the same
 * appointments every open day, so every day but the fixtures' own Tuesday (2026-10-13, whose ids `GET /appointments/{id}`
 * knows) gets ids of its own: the first 28 characters of the fixture's, then the date's eight digits.
 */
export function rangeFromSchedules(dealershipId: string, from: string, to: string): AppointmentListItemResponse[] {
  const items: AppointmentListItemResponse[] = []
  for (let date = from; date <= to; date = shiftDate(date, 1)) {
    for (const item of listItemsOf(defaultSchedule(dealershipId, date))) {
      items.push(date === readingTuesday.date ? item : { ...item, id: `${item.id.slice(0, 28)}${date.replaceAll("-", "")}` })
    }
  }
  return items
}

/** The whole record behind a board appointment, as GET /appointments/{id} answers. */
export function detailsFor(appointment: ScheduledAppointmentResponse, bay: { id: string; name: string }): AppointmentResponse {
  if (appointment.id === interimDetails.id) return { ...interimDetails, status: appointment.status }
  return {
    ...interimDetails,
    id: appointment.id,
    serviceType: appointment.serviceType,
    bay,
    technician: appointment.technician,
    startUtc: appointment.startUtc,
    endUtc: appointment.endUtc,
    startLocal: appointment.startLocal,
    endLocal: appointment.endLocal,
    status: appointment.status,
    customer: { name: appointment.customerName, email: "customer@example.com", phone: "+44 7700 900100" },
    vehicle: { vin: appointment.vin, registration: appointment.registration, make: "Ford", model: "Focus" },
    notes: null,
  }
}

function findOnBoard(appointmentId: string) {
  for (const bay of readingTuesday.bays) {
    const appointment = bay.appointments.find((candidate) => candidate.id === appointmentId)
    if (appointment) return detailsFor(appointment, { id: bay.id, name: bay.name })
  }
  return null
}

const notFound = (resource: string, id: string) =>
  problemResponse(404, {
    type: "https://api.keyloop.example/problems/not-found",
    title: "Resource not found",
    status: 404,
    detail: `No ${resource} with id '${id}' exists.`,
    resource,
    id,
    traceId: "00-438d4c830068d5c9ac8829d1ed9a62c4-688a07bcce305407-01",
  })

async function answer<T>(value: Answer<T>, status = 200): Promise<Response> {
  const resolved = await value
  return resolved instanceof Response ? resolved : jsonResponse(resolved, { status })
}

/**
 * Stubs `fetch` with the dispatch board's API, routed by path: the signed-in identity, dealerships, schedule, the range read,
 * service types, availability, booking, one appointment and its cancellation, and booking intake triage (its status and its
 * suggestions).
 * Each route can be replaced; requests are recorded as with `mockApi`.
 */
export function mockBoardApi(options: BoardApiOptions = {}) {
  return mockApi(async (request) => {
    const url = new URL(request.url)
    const path = url.pathname
    let match: RegExpExecArray | null

    if (path === "/api/v1/me") return answer(options.me?.() ?? serviceAdvisor)
    if (options.admin) {
      const answered = await options.admin.handle(request, url)
      if (answered) return answered
    }
    if (path === "/api/v1/dealerships") return answer(options.dealerships?.() ?? [reading, munich])
    if (path === "/api/v1/booking-triage") return answer(options.triageStatus?.() ?? triageDisabled)
    if (path === "/api/v1/features") return answer(options.features?.() ?? vehicleAwareOff)
    if (path === "/api/v1/vehicle-profiles/resolve" && request.method === "POST") {
      const body = (await request.clone().json()) as ResolveVehicleProfileRequest
      if (options.resolveVehicle) return answer(options.resolveVehicle(body))
      return jsonResponse(body.vin?.toUpperCase().startsWith("WVW") ? decodedVolkswagen : undecoded)
    }
    if ((match = /^\/api\/v1\/dealerships\/([^/]+)\/customer-lookups$/.exec(path)) && request.method === "POST") {
      const body = (await request.clone().json()) as FindReturningCustomersRequest
      return answer(options.customerLookup ? options.customerLookup(match[1], body, request) : [])
    }
    if ((match = /^\/api\/v1\/dealerships\/([^/]+)\/booking-triage\/images$/.exec(path)) && request.method === "POST") {
      const body = (await request.clone().json()) as UploadBookingTriageImageRequest
      return answer(options.uploadTriageImage?.(match[1], body) ?? problemResponse(503, triageUnavailable))
    }
    if ((match = /^\/api\/v1\/dealerships\/([^/]+)\/booking-triage$/.exec(path)) && request.method === "POST") {
      const body = (await request.clone().json()) as TriageBookingRequest
      return answer(options.triage ? options.triage(match[1], body) : problemResponse(503, triageUnavailable))
    }
    if ((match = /^\/api\/v1\/dealerships\/([^/]+)\/schedule$/.exec(path))) {
      const date = url.searchParams.get("date") ?? ""
      return answer(options.schedule?.(match[1], date) ?? defaultSchedule(match[1], date))
    }
    if ((match = /^\/api\/v1\/dealerships\/([^/]+)\/service-types$/.exec(path))) {
      return answer(options.serviceTypes?.(match[1]) ?? [interimServiceType])
    }
    if ((match = /^\/api\/v1\/dealerships\/([^/]+)\/availability$/.exec(path))) {
      const date = url.searchParams.get("date") ?? interimAvailability.date
      const serviceTypeId = url.searchParams.get("serviceTypeId") ?? ""
      return answer(options.availability?.(match[1], serviceTypeId, date) ?? { ...interimAvailability, date })
    }
    if ((match = /^\/api\/v1\/dealerships\/([^/]+)\/appointments$/.exec(path)) && request.method === "GET") {
      const from = url.searchParams.get("from") ?? ""
      const to = url.searchParams.get("to") ?? ""
      const statuses = url.searchParams.getAll("status")
      return answer(options.range?.(match[1], from, to, statuses) ?? rangeFromSchedules(match[1], from, to))
    }
    if ((match = /^\/api\/v1\/dealerships\/([^/]+)\/appointments$/.exec(path)) && request.method === "POST") {
      const body = (await request.clone().json()) as BookAppointmentRequest
      if (options.book) return answer(options.book(match[1], body, request), 201)
      return jsonResponse(bookedFrom(body), { status: 201 })
    }
    if ((match = /^\/api\/v1\/appointments\/([^/]+)\/cancel$/.exec(path)) && request.method === "POST") {
      // Read a copy, so the recorded request's body stays readable for assertions.
      const body = (await request.clone().json()) as { reason?: unknown }
      const id = match[1]
      if (options.cancel) return answer(options.cancel(id, body))
      const details = findOnBoard(id)
      return details
        ? jsonResponse({ ...details, status: "Cancelled", cancellationReason: body.reason })
        : notFound("appointment", id)
    }
    if ((match = /^\/api\/v1\/appointments\/([^/]+)$/.exec(path))) {
      const id = match[1]
      if (options.appointment) return answer(options.appointment(id))
      return findOnBoard(id) ? jsonResponse(findOnBoard(id)) : notFound("appointment", id)
    }
    return new Response("", { status: 404, statusText: "Not Found" })
  })
}

/** Requests to one route, by path suffix ("/schedule", "/cancel"). */
export function requestsTo(requests: readonly Request[], suffix: string): Request[] {
  return requests.filter((request) => new URL(request.url).pathname.endsWith(suffix))
}
