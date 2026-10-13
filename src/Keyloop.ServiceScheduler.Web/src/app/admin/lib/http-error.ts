import type { HttpError } from "@refinedev/core"

import { describeFailure, fieldErrors, parseProblem, UnexpectedResponseError } from "@/lib/problem-details"

/** Refine `HttpError` extended with the API's `traceId` and original failure `cause`. */
export interface SchedulerHttpError extends HttpError {
  /** The API's trace id, for the Aspire dashboard's trace search. */
  traceId?: string
  /** The RFC 9457 problem, the response without one, or the transport failure; absent for the data provider's own refusals. */
  cause?: unknown
}

/** Converts an API client error into a `SchedulerHttpError` with normalized field errors. */
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
