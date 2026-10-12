import { client } from "@/api/client.gen"
import { parseProblem, UnexpectedResponseError } from "@/lib/problem-details"

type Client = typeof client

export const REQUEST_ID_HEADER = "X-Request-Id"

/**
 * Gives each request its own id (a UUID) for the API's logs and traces (§12.2), unless the caller chose one: the stress panel
 * can mint the ids itself to know them before the answers arrive (it should mint UUIDs too). An interceptor runs once per
 * request, after the `Request` is built and before any fetch is called, including a per-request `fetch` such as the span
 * helper's in lib/telemetry.ts, which would bypass a wrapper around the configured fetch.
 */
export function stampRequestId(request: Request): Request {
  if (!request.headers.has(REQUEST_ID_HEADER)) request.headers.set(REQUEST_ID_HEADER, crypto.randomUUID())
  return request
}

/**
 * Keeps the HTTP status of an error response that carries no problem body. The generated client would report it as the raw
 * text, or as `{}` when the body is empty (the Vite proxy's 502 while the API is down). Problem bodies, failures
 * without a response (network errors) and failures of successful responses pass through unchanged.
 */
export function keepStatusOfBareErrors(error: unknown, response: Response | undefined): unknown {
  if (!response || response.ok || parseProblem(error)) return error
  const body = typeof error === "string" ? error : JSON.stringify(error ?? "")
  return new UnexpectedResponseError(response.status, response.statusText, body)
}

/** Registers the interceptors on a client once; repeated calls (module reloads during development) change nothing. */
export function configureApiClient(target: Client): Client {
  if (!target.interceptors.request.exists(stampRequestId)) target.interceptors.request.use(stampRequestId)
  if (!target.interceptors.error.exists(keepStatusOfBareErrors)) target.interceptors.error.use(keepStatusOfBareErrors)
  return target
}

/** The generated client every SDK function, query option and mutation option uses, configured for this app. */
configureApiClient(client)

export { client }
