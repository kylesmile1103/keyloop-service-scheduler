/**
 * Reading what went wrong with an API call. Every application error from the API is an RFC 9457 problem with a `traceId`
 * (SYSTEM_DESIGN §8.7); anything else is a failure outside the API (no answer at all, or a proxy's bare status).
 */

/**
 * A problem body. The generated `ProblemDetails` type declares only the standard members; the extensions the catalogue adds
 * (`errors`, `suggestedSlots`, `retryAfterSeconds`, …) arrive as extra members.
 */
export interface ProblemDetails {
  type?: string
  title?: string
  status?: number
  detail?: string
  instance?: string
  traceId?: string
  errors?: Record<string, string[]>
  suggestedSlots?: Array<{ startUtc: string; endUtc: string; startLocal: string }>
  [k: string]: unknown
}

/**
 * An error response without a problem body, such as the empty 502 the Vite proxy sends while the API is down, or a gateway's
 * HTML page. The generated client would otherwise report it as `{}` or a string and lose the status; src/lib/api-client.ts
 * turns such responses into this error.
 */
export class UnexpectedResponseError extends Error {
  override readonly name = "UnexpectedResponseError"
  readonly status: number
  readonly statusText: string
  readonly body: string

  constructor(status: number, statusText: string, body: string) {
    super(`The server answered ${status}${statusText ? ` ${statusText}` : ""} without details.`)
    this.status = status
    this.statusText = statusText
    this.body = body
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Error)
}

function isProblem(value: unknown): value is ProblemDetails {
  return (
    isRecord(value) &&
    (typeof value.type === "string" || typeof value.title === "string" || typeof value.status === "number")
  )
}

/**
 * The problem in an error from the generated client: the thrown body (query and mutation options use `throwOnError`) or the
 * `error` member of a non-throwing SDK call's result. `null` when the failure carries no problem.
 */
export function parseProblem(error: unknown): ProblemDetails | null {
  if (isProblem(error)) return error
  if (isRecord(error) && isProblem(error.error)) return error.error
  return null
}

export interface FailureDescription {
  /** One or two sentences for the person at the screen. */
  summary: string
  /** The API's trace id, for the Aspire dashboard's trace search (§12.2). */
  traceId?: string
}

/** What to tell the user about a failed call, whichever shape the failure took. */
export function describeFailure(error: unknown): FailureDescription {
  const problem = parseProblem(error)
  if (problem) {
    const summary = problem.detail || problem.title || `The server answered ${problem.status ?? "an error"}.`
    return problem.traceId ? { summary, traceId: problem.traceId } : { summary }
  }
  if (error instanceof UnexpectedResponseError) return { summary: error.message }
  // fetch rejects with a TypeError when no response arrives (offline, refused connection, CORS).
  if (error instanceof TypeError) {
    return { summary: "The server could not be reached. Check the connection, then try again." }
  }
  return { summary: "Something went wrong, and the server sent no explanation." }
}
