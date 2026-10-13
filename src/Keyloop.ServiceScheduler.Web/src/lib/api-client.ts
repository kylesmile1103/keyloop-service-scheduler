import { client } from "@/api/client.gen"
import { parseProblem, UnexpectedResponseError } from "@/lib/problem-details"

type Client = typeof client

export const REQUEST_ID_HEADER = "X-Request-Id"

/** Attaches a fresh `X-Request-Id` UUID header to outgoing requests unless already set. */
export function stampRequestId(request: Request): Request {
  if (!request.headers.has(REQUEST_ID_HEADER)) request.headers.set(REQUEST_ID_HEADER, crypto.randomUUID())
  return request
}

/** Preserves HTTP status codes on error responses that do not carry a Problem Details body. */
export function keepStatusOfBareErrors(error: unknown, response: Response | undefined): unknown {
  if (!response || response.ok || parseProblem(error)) return error
  const body = typeof error === "string" ? error : JSON.stringify(error ?? "")
  return new UnexpectedResponseError(response.status, response.statusText, body)
}

/** Registers request-ID and bare-error interceptors idempotently on `target`. */
export function configureApiClient(target: Client): Client {
  if (!target.interceptors.request.exists(stampRequestId)) target.interceptors.request.use(stampRequestId)
  if (!target.interceptors.error.exists(keepStatusOfBareErrors)) target.interceptors.error.use(keepStatusOfBareErrors)
  return target
}

configureApiClient(client)

export { client }
