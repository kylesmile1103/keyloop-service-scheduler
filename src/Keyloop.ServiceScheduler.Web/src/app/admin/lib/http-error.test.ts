import { describe, expect, it } from "vitest"

import { UnexpectedResponseError } from "@/lib/problem-details"

import { toHttpError } from "./http-error"

const traceId = "00-438d4c830068d5c9ac8829d1ed9a62c4-688a07bcce305407-01"

describe("toHttpError", () => {
  it("turns a validation problem into Refine's HttpError with its field errors under the form's field paths", () => {
    const problem = {
      type: "https://api.keyloop.example/problems/validation-error",
      title: "One or more validation errors occurred.",
      status: 400,
      detail: "See the errors member for details.",
      traceId,
      errors: { "Customer.Email": ["customer.email must be an email address."], date: ["date must be written yyyy-MM-dd."] },
    }

    const error = toHttpError(problem)

    expect(error).toMatchObject({
      statusCode: 400,
      message: "See the errors member for details.",
      errors: { "customer.email": "customer.email must be an email address.", date: "date must be written yyyy-MM-dd." },
      traceId,
    })
    // The page shows the failure as the rest of the app does, from the original problem.
    expect(error.cause).toBe(problem)
  })

  it("keeps a problem's status, words and trace id", () => {
    const problem = {
      type: "https://api.keyloop.example/problems/not-found",
      title: "Resource not found",
      status: 404,
      detail: "No dealership with id '1' exists.",
      traceId,
    }

    expect(toHttpError(problem)).toEqual({ statusCode: 404, message: "No dealership with id '1' exists.", traceId, cause: problem })
  })

  it("keeps the status of an error response without a problem body", () => {
    const failure = new UnexpectedResponseError(502, "Bad Gateway", "")

    expect(toHttpError(failure)).toEqual({ statusCode: 502, message: "The server answered 502 Bad Gateway without details.", cause: failure })
  })

  it("says that the server could not be reached when no answer arrived", () => {
    const failure = new TypeError("Failed to fetch")

    expect(toHttpError(failure)).toEqual({
      statusCode: 0,
      message: "The server could not be reached. Check the connection, then try again.",
      cause: failure,
    })
  })
})
