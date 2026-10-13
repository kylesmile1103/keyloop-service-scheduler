/** RFC 9457 Problem Details payload with optional validation and domain extension fields. */
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

/** Error wrapper for non-OK HTTP responses that do not carry a Problem Details body. */
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

/** Extracts a `ProblemDetails` object from a thrown error or SDK `{ error }` result, or returns `null`. */
export function parseProblem(error: unknown): ProblemDetails | null {
  if (isProblem(error)) return error
  if (isRecord(error) && isProblem(error.error)) return error.error
  return null
}

/** Extracts the HTTP status code from a Problem Details object, `UnexpectedResponseError`, or Refine `HttpError`. */
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

/** Formats a user-facing alert title for a 401 or 403 write refusal. */
export function authRefusalTitle(status: 401 | 403, action: string): string {
  return status === 401 ? `Couldn’t ${action}: you’re signed out` : `Couldn’t ${action}: your role doesn’t allow it`
}

export interface FailureDescription {
  summary: string
  traceId?: string
}

/** Formats an unknown API failure into a user-facing summary and optional trace ID. */
export function describeFailure(error: unknown): FailureDescription {
  const problem = parseProblem(error)
  if (problem) {
    const summary = problem.detail || problem.title || `The server answered ${problem.status ?? "an error"}.`
    return problem.traceId ? { summary, traceId: problem.traceId } : { summary }
  }
  if (error instanceof UnexpectedResponseError) return { summary: error.message }
  if (error instanceof TypeError) {
    return { summary: "The server could not be reached. Check the connection, then try again." }
  }
  return { summary: "Something went wrong, and the server sent no explanation." }
}

const failureKeys = new WeakMap<object, number>()
let lastFailureKey = 0

/** Returns a stable React key per distinct error instance so screen readers re-announce repeated failures on retry. */
export function failureKey(error: unknown): string {
  if (typeof error !== "object" || error === null) return `value:${String(error)}`
  let key = failureKeys.get(error)
  if (key === undefined) failureKeys.set(error, (key = ++lastFailureKey))
  return `failure:${key}`
}

const catalogue = "https://api.keyloop.example/problems/"

/** Extracts the problem slug from `problem.type` when it belongs to the API problem catalogue, or `""`. */
export function problemSlug(problem: ProblemDetails): string {
  if (!problem.type?.startsWith(catalogue)) return ""
  return problem.type.slice(catalogue.length).split("/").filter(Boolean).at(-1) ?? ""
}

const camelPath = (path: string) =>
  path
    .split(".")
    .map((segment) => segment.charAt(0).toLowerCase() + segment.slice(1))
    .join(".")

/**
 * Normalises `problem.errors` keys to camelCase paths and replaces leading field paths in messages
 * with human-readable labels when provided.
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
