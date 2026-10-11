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

const catalogue = "https://api.keyloop.example/problems/"

/**
 * The problem's slug from the catalogue (SYSTEM_DESIGN §8.7): the last path segment of its `type`, such as
 * `invalid-state-transition`. Empty for a problem outside the catalogue (the framework's RFC links) or without a type, so
 * branching on the slug never matches by accident.
 */
export function problemSlug(problem: ProblemDetails): string {
  if (!problem.type?.startsWith(catalogue)) return ""
  return problem.type.slice(catalogue.length).split("/").filter(Boolean).at(-1) ?? ""
}

/**
 * A validation problem's field errors, one sentence per field, keyed by the form's field paths. The API already keys `errors`
 * by camelCase JSON path (`customer.email`); each segment's first letter is lowered too, so a PascalCase path
 * (`Vehicle.Vin`) maps onto the same field. Several messages for one field are joined.
 */
export function fieldErrors(problem: ProblemDetails): Record<string, string> {
  const camel = (segment: string) => segment.charAt(0).toLowerCase() + segment.slice(1)
  return Object.fromEntries(
    Object.entries(problem.errors ?? {}).map(([path, messages]) => [path.split(".").map(camel).join("."), messages.join(" ")])
  )
}
