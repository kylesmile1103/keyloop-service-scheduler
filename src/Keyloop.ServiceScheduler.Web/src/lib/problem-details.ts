/**
 * Reading what went wrong with an API call. Every application error from the API is an RFC 9457 problem with a `traceId`
 * (ARCHITECTURE §8.7); anything else is a failure outside the API (no answer at all, or a proxy's bare status).
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

/**
 * The HTTP status behind a failure, whichever shape it took: a problem's `status`, a bare error response's status, or the
 * `statusCode` of the admin area's Refine `HttpError` (or of the failure it wraps). `undefined` when no response arrived.
 */
export function failureStatus(error: unknown): number | undefined {
  const problem = parseProblem(error)
  if (typeof problem?.status === "number") return problem.status
  if (error instanceof UnexpectedResponseError) return error.status
  if (isRecord(error)) {
    if (typeof error.statusCode === "number" && error.statusCode > 0) return error.statusCode
    if ("cause" in error && error.cause !== error) return failureStatus(error.cause)
  }
  return undefined
}

/**
 * The headline for a refused write in the words of what was being done ("book", "cancel the appointment"): a `401` says
 * the user is signed out, a `403` that the role does not allow it. The API's titles ("Authentication required",
 * "Forbidden") are the catalogue's, not the screen's.
 */
export function authRefusalTitle(status: 401 | 403, action: string): string {
  return status === 401 ? `Couldn’t ${action}: you’re signed out` : `Couldn’t ${action}: your role doesn’t allow it`
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

const failureKeys = new WeakMap<object, number>()
let lastFailureKey = 0

/**
 * A React key for a failure's explanation: the same for the same error object, new for every other one. A screen reader
 * reads out what an alert gains, not text that stays, so an explanation keyed with it is read out again when a retry
 * fails in the same words as before, while the alert and its focused Try again stay.
 */
export function failureKey(error: unknown): string {
  if (typeof error !== "object" || error === null) return `value:${String(error)}`
  let key = failureKeys.get(error)
  if (key === undefined) failureKeys.set(error, (key = ++lastFailureKey))
  return `failure:${key}`
}

const catalogue = "https://api.keyloop.example/problems/"

/**
 * The problem's slug from the catalogue (ARCHITECTURE §8.7): the last path segment of its `type`, such as
 * `invalid-state-transition`. Empty for a problem outside the catalogue (the framework's RFC links) or without a type, so
 * branching on the slug never matches by accident.
 */
export function problemSlug(problem: ProblemDetails): string {
  if (!problem.type?.startsWith(catalogue)) return ""
  return problem.type.slice(catalogue.length).split("/").filter(Boolean).at(-1) ?? ""
}

/** A JSON path with each segment's first letter lowered: `Vehicle.Vin` and `vehicle.vin` name the same field. */
const camelPath = (path: string) =>
  path
    .split(".")
    .map((segment) => segment.charAt(0).toLowerCase() + segment.slice(1))
    .join(".")

/**
 * A validation problem's field errors, one sentence per field, keyed by the form's field paths. The API already keys `errors`
 * by camelCase JSON path (`customer.email`); each segment's first letter is lowered too, so a PascalCase path
 * (`Vehicle.Vin`) maps onto the same field. Several messages for one field are joined.
 *
 * The API's sentences name their field by that path ("customer.email must be an email address ..."), which is the request
 * body's vocabulary, not the screen's. Given the form's label for a path (`{ "customer.email": "Email" }`), a message that
 * opens with the path opens with the label instead ("Email must be an email address ..."); other messages, and fields
 * without a label, keep the API's words.
 */
export function fieldErrors(problem: ProblemDetails, labels: Readonly<Record<string, string>> = {}): Record<string, string> {
  const named = (message: string, path: string) => {
    const label = labels[path]
    const space = message.indexOf(" ")
    return label && space > 0 && camelPath(message.slice(0, space)) === path ? `${label}${message.slice(space)}` : message
  }
  return Object.fromEntries(
    Object.entries(problem.errors ?? {}).map(([key, messages]) => {
      const path = camelPath(key)
      return [path, messages.map((message) => named(message, path)).join(" ")]
    })
  )
}
