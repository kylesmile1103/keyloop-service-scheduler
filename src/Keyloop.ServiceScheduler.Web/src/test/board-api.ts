import type {
  AppointmentResponse,
  AvailabilityResponse,
  DealershipResponse,
  ScheduledAppointmentResponse,
  ServiceTypeResponse,
  WorkshopScheduleResponse,
} from "@/api/types.gen"
import { munich, reading } from "@/test/dealerships"
import { jsonResponse, mockApi, problemResponse } from "@/test/mock-api"
import {
  interimAvailability,
  interimDetails,
  interimServiceType,
  munichTuesday,
  readingSunday,
  readingTuesday,
} from "@/test/schedules"

type Answer<T> = T | Response | Promise<T | Response>

export interface BoardApiOptions {
  dealerships?: () => Answer<DealershipResponse[]>
  /** The schedule for a dealership and date. By default: Reading's Tuesday (Sunday closed), München's Tuesday. */
  schedule?: (dealershipId: string, date: string) => Answer<WorkshopScheduleResponse>
  /** The dealership's catalogue. By default: Interim Service only. */
  serviceTypes?: (dealershipId: string) => Answer<ServiceTypeResponse[]>
  /** Free starts for a service on a date. By default: Interim Service's, whatever the service asked for. */
  availability?: (dealershipId: string, serviceTypeId: string, date: string) => Answer<AvailabilityResponse>
  appointment?: (appointmentId: string) => Answer<AppointmentResponse>
  cancel?: (appointmentId: string, body: { reason?: unknown }) => Answer<AppointmentResponse>
}

/** The default schedule: the fixture for the dealership, dated as asked (Reading is closed on Sundays). */
export function defaultSchedule(dealershipId: string, date: string): WorkshopScheduleResponse {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  if (dealershipId === munich.id) {
    // München closes at weekends.
    const closed = weekday === 0 || weekday === 6
    return closed ? { ...munichTuesday, date, operatingWindow: null } : { ...munichTuesday, date }
  }
  return { ...(weekday === 0 ? readingSunday : readingTuesday), date }
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

async function answer<T>(value: Answer<T>): Promise<Response> {
  const resolved = await value
  return resolved instanceof Response ? resolved : jsonResponse(resolved)
}

/**
 * Stubs `fetch` with the dispatch board's API, routed by path: dealerships, schedule, service types, availability, one
 * appointment and its cancellation. Each route can be replaced; requests are recorded as with `mockApi`.
 */
export function mockBoardApi(options: BoardApiOptions = {}) {
  return mockApi(async (request) => {
    const url = new URL(request.url)
    const path = url.pathname
    let match: RegExpExecArray | null

    if (path === "/api/v1/dealerships") return answer(options.dealerships?.() ?? [reading, munich])
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
