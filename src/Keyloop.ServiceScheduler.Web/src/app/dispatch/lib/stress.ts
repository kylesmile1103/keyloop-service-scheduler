import { bookAppointment } from "@/api/sdk.gen"
import type { BookAppointmentRequest } from "@/api/types.gen"
import { parseProblem, problemSlug } from "@/lib/problem-details"

/**
 * One request of a stress run: its HTTP status (0 when no answer came), the problem's slug and trace id, and how long it took;
 * a `201` also names the appointment it made, so the board can point at the winner.
 */
export type StressOutcome = {
  index: number
  status: number
  slug: string | null
  traceId: string | null
  durationMs: number
  appointmentId?: string
}

/** The traffic light's outcomes (DESIGN_SYSTEM 11.17): booked, slot taken, rate limited, server error, no answer, anything else. */
export type OutcomeKind = "booked" | "taken" | "rate-limited" | "server" | "failed" | "other"

export function outcomeKind(status: number): OutcomeKind {
  if (status >= 200 && status < 300) return "booked"
  if (status === 409) return "taken"
  if (status === 429) return "rate-limited"
  if (status >= 500) return "server"
  if (status === 0) return "failed"
  return "other"
}

const SERVER_ERRORS = "5xx"
const NO_RESPONSE = "No response"

/** The row an outcome is counted in: "201 Created", "409 slot-unavailable", "5xx", "No response", or "<status> <slug>". */
function rowOf({ status, slug }: StressOutcome): string {
  if (status === 201) return "201 Created"
  if (status >= 500) return SERVER_ERRORS
  if (status === 0) return NO_RESPONSE
  return slug ? `${status} ${slug}` : String(status)
}

/** Sort order of the rows: successes, then conflicts and other refusals by status, then server errors, then no answer. */
function rank(label: string): number {
  if (label === SERVER_ERRORS) return 600
  if (label === NO_RESPONSE) return 700
  return Number.parseInt(label, 10) || 650
}

/**
 * Responses counted by status and problem slug, e.g. "201 Created" 1, "409 slot-unavailable" 29, "5xx" 0. The 5xx row is
 * always present (the proof wants it to read 0); other rows appear only when they occurred. Rows of the same status keep the
 * order their first response arrived in.
 */
export function tally(outcomes: StressOutcome[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>([[SERVER_ERRORS, 0]])
  for (const outcome of outcomes) {
    const label = rowOf(outcome)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts]
    .map(([label, count], order) => ({ label, count, order }))
    .sort((a, b) => rank(a.label) - rank(b.label) || a.order - b.order)
    .map(({ label, count }) => ({ label, count }))
}

/** p50 and p95 (nearest rank) and the slowest request, in whole milliseconds; `null` before any request has finished. */
export function latency(outcomes: StressOutcome[]): { p50: number; p95: number; max: number } | null {
  if (outcomes.length === 0) return null
  const sorted = outcomes.map((outcome) => outcome.durationMs).sort((a, b) => a - b)
  const percentile = (p: number) => sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]
  return { p50: Math.round(percentile(50)), p95: Math.round(percentile(95)), max: Math.round(sorted[sorted.length - 1]) }
}

/** A VIN that is valid (17 characters, no I, O or Q) and different for every request of a run. */
function stressVin(index: number): string {
  return `KLSTRESS${String(index + 1).padStart(9, "0")}`
}

/** One request's booking: the chosen service and slot, with its own customer and vehicle so no two requests look alike. */
export function stressBooking(index: number, slot: Pick<BookAppointmentRequest, "serviceTypeId" | "startUtc">): BookAppointmentRequest {
  const number = index + 1
  return {
    serviceTypeId: slot.serviceTypeId,
    startUtc: slot.startUtc,
    customer: { name: `Stress test ${number}`, email: `stress.test+${number}@example.com`, phone: "+44 7700 900000" },
    vehicle: { vin: stressVin(index), registration: `ST${String(number).padStart(2, "0")} KLP`, make: "Stress", model: "Test" },
    notes: `Concurrency stress test, request ${number}`,
  }
}

interface FireOptions {
  /** The span's fetch (lib/telemetry.ts `withSpan`), so every request joins the `ui.stress_test` trace. */
  fetch?: typeof fetch
  /** Called as each answer arrives, for the live tally. */
  onSettled?: (outcome: StressOutcome) => void
}

/**
 * Fires `n` bookings for the same dealership at once (`Promise.all`, no idempotency keys: each request is its own booking
 * intention) through the generated SDK, and reports every answer. The proof expects exactly one `201` and `n - 1` `409`s
 * for a slot with one free bay and technician (SYSTEM_DESIGN §7, Task 13). Never rejects: a request that gets no answer is
 * recorded as status 0.
 */
export async function fireParallelBookings(
  n: number,
  build: (index: number) => BookAppointmentRequest,
  dealershipId: string,
  options: FireOptions = {}
): Promise<StressOutcome[]> {
  const one = async (index: number): Promise<StressOutcome> => {
    const started = performance.now()
    let outcome: StressOutcome
    try {
      const { response, error, data } = await bookAppointment({
        path: { dealershipId },
        body: build(index),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      })
      const problem = parseProblem(error)
      outcome = {
        index,
        status: response?.status ?? 0,
        slug: problem ? problemSlug(problem) || null : null,
        traceId: problem?.traceId ?? null,
        durationMs: performance.now() - started,
        ...(data?.id ? { appointmentId: data.id } : {}),
      }
    } catch {
      outcome = { index, status: 0, slug: null, traceId: null, durationMs: performance.now() - started }
    }
    options.onSettled?.(outcome)
    return outcome
  }
  return Promise.all(Array.from({ length: n }, (_, index) => one(index)))
}
