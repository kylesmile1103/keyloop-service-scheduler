import type { HttpError } from "@refinedev/core"

import { describeFailure, fieldErrors, parseProblem, UnexpectedResponseError } from "@/lib/problem-details"

/**
 * Refine's `HttpError` for a failed call to the API. Refine reads `statusCode`, `message` and the field `errors` (its forms
 * put them under their fields); the views show `cause`, the failure as the generated client reported it, with the rest of
 * the app's failed states (the API's words, its trace id).
 */
export interface SchedulerHttpError extends HttpError {
  /** The API's trace id, for the Aspire dashboard's trace search. */
  traceId?: string
  /** The RFC 9457 problem, the response without one, or the transport failure; absent for the data provider's own refusals. */
  cause?: unknown
}

/**
 * Maps a failure of the generated client to Refine's `HttpError`: an RFC 9457 problem keeps its status, its `detail` (or
 * `title`) as the message, its trace id and its field errors under the form's field paths (`Customer.Email` becomes
 * `customer.email`); a response without a problem keeps its status; no answer at all is status 0.
 */
export function toHttpError(error: unknown): SchedulerHttpError {
  const problem = parseProblem(error)
  const { summary, traceId } = describeFailure(error)
  const statusCode = problem?.status ?? (error instanceof UnexpectedResponseError ? error.status : 0)
  const errors = problem?.errors ? fieldErrors(problem) : undefined
  return { statusCode, message: summary, ...(errors && { errors }), ...(traceId && { traceId }), cause: error }
}

/** The data provider's own refusal (a resource it does not know, a read-only list). */
export function refusal(statusCode: number, message: string): SchedulerHttpError {
  return { statusCode, message }
}

/** What a failed view shows: the API's failure behind the error, or the refusal in its own words. */
export function shownFailure(error: SchedulerHttpError): unknown {
  return error.cause !== undefined ? error.cause : { title: error.message, status: error.statusCode }
}
