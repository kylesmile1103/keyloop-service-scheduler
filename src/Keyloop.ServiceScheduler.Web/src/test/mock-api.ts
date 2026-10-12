import { vi } from "vitest"

type Handler = (request: Request) => Response | Promise<Response>

/**
 * A request whose body can be read again at any time: it keeps the bytes and builds every clone from them. A plain
 * `Request.clone()` tees the body's stream, and Node 22's fetch (undici 6.21) cancels the original's half once a clone has
 * been read and garbage-collected, so a later `clone()` failed with "unusable" depending on when the collector ran.
 */
class ReplayableRequest extends Request {
  readonly #bytes: ArrayBuffer | null

  constructor(source: Request, bytes: ArrayBuffer | null) {
    super(source.url, { method: source.method, headers: source.headers, body: bytes, signal: source.signal })
    this.#bytes = bytes
  }

  override clone(): Request {
    return new ReplayableRequest(this, this.#bytes)
  }
}

/**
 * Replaces the global `fetch` for one test (vitest's `unstubGlobals` restores it) and records every request the generated
 * client sends. The handler answers by path, e.g. `mockApi((r) => jsonResponse([...]))`. A request is counted as soon as
 * it is sent; its body (read once, never teed) stays readable for assertions whatever the handler does with it.
 */
export function mockApi(handler: Handler) {
  const requests: Request[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const sent = input instanceof Request ? input : new Request(input, init)
    const slot = requests.push(sent) - 1
    const bytes = sent.body ? await sent.arrayBuffer() : null
    requests[slot] = new ReplayableRequest(sent, bytes)
    return handler(new ReplayableRequest(sent, bytes))
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
