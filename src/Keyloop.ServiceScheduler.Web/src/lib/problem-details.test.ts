import { describe, expect, it } from "vitest"

import { describeFailure, parseProblem, UnexpectedResponseError } from "@/lib/problem-details"

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
