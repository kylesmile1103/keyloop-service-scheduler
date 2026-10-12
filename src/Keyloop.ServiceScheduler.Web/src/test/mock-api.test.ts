import { describe, expect, it } from "vitest"

import { jsonResponse, mockApi } from "./mock-api"

// The recorded requests are what tests assert on, so their bodies must stay readable whatever happened to the request
// that was sent: Node 22's fetch (undici 6.21) cancels a request's body once a clone of it has been read and garbage
// collected, which made `request.clone().json()` in an assertion fail at random with "unusable".

describe("mockApi", () => {
  it("keeps a recorded request's body readable after the handler has read it", async () => {
    const { requests } = mockApi(async (request) => jsonResponse(await request.json()))

    await fetch("http://localhost/api/v1/things", { method: "POST", body: JSON.stringify({ name: "Bay 1" }) })

    expect(await requests[0].clone().json()).toEqual({ name: "Bay 1" })
    expect(await requests[0].clone().json()).toEqual({ name: "Bay 1" })
  })

  it("records each request with its method, address and headers as it is sent", async () => {
    const { requests } = mockApi(() => jsonResponse({}))

    const sent = fetch("http://localhost/api/v1/things?date=2026-10-13", {
      method: "POST",
      headers: { "Idempotency-Key": "key-1" },
      body: "{}",
    })
    // Counted at once, before any answer, so a test can tell that nothing was sent.
    expect(requests).toHaveLength(1)
    await sent

    expect(requests[0].method).toBe("POST")
    expect(requests[0].url).toBe("http://localhost/api/v1/things?date=2026-10-13")
    expect(requests[0].headers.get("Idempotency-Key")).toBe("key-1")
    expect(requests[0]).toBeInstanceOf(Request)
  })

  it("records a request without a body", async () => {
    const { requests } = mockApi(() => jsonResponse([]))

    await fetch("http://localhost/api/v1/dealerships")

    expect(requests[0].method).toBe("GET")
    expect(requests[0].body).toBeNull()
  })
})
