import { describe, expect, it } from "vitest"

import { describeFailure, fieldErrors, parseProblem, problemSlug, UnexpectedResponseError } from "@/lib/problem-details"

const rateLimited = {
  type: "https://api.keyloop.example/problems/rate-limited",
  title: "Too many requests",
  status: 429,
  detail: "Too many requests from this client. Retry after 3 seconds.",
  instance: "/api/v1/dealerships",
  traceId: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  retryAfterSeconds: 3,
}

describe("parseProblem", () => {
  it("reads a problem body thrown by the generated query options, extensions included", () => {
    expect(parseProblem(rateLimited)).toEqual(rateLimited)
  })

  it("reads the error of a non-throwing SDK call's result", () => {
    expect(parseProblem({ error: rateLimited, request: {}, response: {} })).toEqual(rateLimited)
  })

  it.each([
    ["a network failure", new TypeError("Failed to fetch")],
    ["a failure without a problem body", new UnexpectedResponseError(500, "Internal Server Error", "")],
    ["an empty body", {}],
    ["a text body", "Bad Gateway"],
    ["an array", [rateLimited]],
    ["nothing", undefined],
  ])("returns null for %s", (_, error) => {
    expect(parseProblem(error)).toBeNull()
  })
})

describe("describeFailure", () => {
  it("uses the problem's detail and keeps its trace id", () => {
    expect(describeFailure(rateLimited)).toEqual({
      summary: "Too many requests from this client. Retry after 3 seconds.",
      traceId: rateLimited.traceId,
    })
  })

  it("falls back to the problem's title when it has no detail", () => {
    expect(describeFailure({ title: "Resource not found", status: 404, traceId: "abc" })).toEqual({
      summary: "Resource not found",
      traceId: "abc",
    })
  })

  it("names the status of a failure without a problem body", () => {
    expect(describeFailure(new UnexpectedResponseError(502, "Bad Gateway", "<html>"))).toEqual({
      summary: "The server answered 502 Bad Gateway without details.",
    })
    expect(describeFailure(new UnexpectedResponseError(500, "", ""))).toEqual({
      summary: "The server answered 500 without details.",
    })
  })

  it("says the server could not be reached when the request never got an answer", () => {
    expect(describeFailure(new TypeError("Failed to fetch"))).toEqual({
      summary: "The server could not be reached. Check the connection, then try again.",
    })
  })

  it("never shows nothing", () => {
    expect(describeFailure({})).toEqual({ summary: "Something went wrong, and the server sent no explanation." })
  })
})

// The cancel endpoint's real answers (captured from the API in Development).
const alreadyCancelled = {
  type: "https://api.keyloop.example/problems/invalid-state-transition",
  title: "Invalid state transition",
  status: 409,
  detail: "Cannot cancel this appointment while it is Cancelled.",
  instance: "/api/v1/appointments/2af6cbb1-1aec-8b16-b666-7a694cced4d0/cancel",
  currentStatus: "Cancelled",
  attempted: "cancel",
  traceId: "00-c891f6205bdf228d5ac20dc267806559-144af9ccbd8f8f2b-01",
}

describe("the brief's problem helpers", () => {
  it("parses_hey_api_error_shape", () => {
    // A mutation built from the generated options throws the body; a direct SDK call returns { data, error, request, response }.
    const response = new Response(JSON.stringify(alreadyCancelled), { status: 409 })
    expect(parseProblem(alreadyCancelled)).toBe(alreadyCancelled)
    expect(parseProblem({ data: undefined, error: alreadyCancelled, request: new Request("http://localhost/"), response })).toBe(
      alreadyCancelled
    )
    expect(parseProblem(alreadyCancelled)?.currentStatus).toBe("Cancelled")
  })

  it("slug_from_type", () => {
    expect(problemSlug(alreadyCancelled)).toBe("invalid-state-transition")
    expect(problemSlug({ type: "https://api.keyloop.example/problems/concurrency-conflict/" })).toBe("concurrency-conflict")
    // Framework-generated problems keep their RFC links (SYSTEM_DESIGN §8.7); they have no catalogue slug.
    expect(problemSlug({ type: "https://tools.ietf.org/html/rfc9110#section-15.5.5" })).toBe("")
    expect(problemSlug({ title: "No type" })).toBe("")
  })

  it("fieldErrors_lowercases_paths", () => {
    expect(
      fieldErrors({
        errors: {
          "Vehicle.Vin": ["VIN must be 17 characters.", "VIN must not contain I, O or Q."],
          "Customer.Email": ["Email is not valid."],
          ServiceTypeId: ["serviceTypeId is required."],
          reason: ["reason is required, 1 to 500 characters after trimming."],
        },
      })
    ).toEqual({
      "vehicle.vin": "VIN must be 17 characters. VIN must not contain I, O or Q.",
      "customer.email": "Email is not valid.",
      serviceTypeId: "serviceTypeId is required.",
      reason: "reason is required, 1 to 500 characters after trimming.",
    })
    expect(fieldErrors(alreadyCancelled)).toEqual({})
  })

  it("fieldErrors_names_a_field_by_its_label_instead_of_its_path", () => {
    const problem = {
      errors: {
        "customer.email": ["customer.email must be an email address of at most 254 characters."],
        "Vehicle.Vin": ["vehicle.vin must be a 17-character VIN.", "Vehicle.Vin must not contain I, O or Q."],
        reason: ["reason is required, 1 to 500 characters after trimming."],
        notes: ["Keep it under 1000 characters."],
        "Idempotency-Key": ["Idempotency-Key must be 1 to 64 characters."],
      },
    }

    expect(fieldErrors(problem, { "customer.email": "Email", "vehicle.vin": "VIN", reason: "Reason", notes: "Notes" })).toEqual({
      "customer.email": "Email must be an email address of at most 254 characters.",
      "vehicle.vin": "VIN must be a 17-character VIN. VIN must not contain I, O or Q.",
      reason: "Reason is required, 1 to 500 characters after trimming.",
      // A message that does not open with the path is the API's own sentence, kept as it is.
      notes: "Keep it under 1000 characters.",
      // Without a label, the API's words stay.
      "idempotency-Key": "Idempotency-Key must be 1 to 64 characters.",
    })
  })
})
