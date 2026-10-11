import { vi } from "vitest"

type Handler = (request: Request) => Response | Promise<Response>

/**
 * Replaces the global `fetch` for one test (vitest's `unstubGlobals` restores it) and records every request the generated
 * client sends. The handler answers by path, e.g. `mockApi((r) => jsonResponse([...]))`.
 */
export function mockApi(handler: Handler) {
  const requests: Request[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    requests.push(request)
    return handler(request)
  })
  vi.stubGlobal("fetch", fetchMock)
  return { requests, fetchMock }
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  })
}

export function problemResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/problem+json" } })
}
