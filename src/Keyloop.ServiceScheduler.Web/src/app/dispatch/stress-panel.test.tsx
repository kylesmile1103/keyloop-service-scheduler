import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { BookAppointmentRequest } from "@/api/types.gen"
import * as telemetry from "@/lib/telemetry"
import { bookedFrom, mockBoardApi, requestsTo } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { problemResponse } from "@/test/mock-api"
import { phoneViewport, pointerClick, renderBoard } from "@/test/render-board"

// The concurrency stress panel (Task 17): N bookings for one slot at once, tallied live, with every answer listed.

vi.mock("@/lib/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/telemetry")>()
  return { ...actual, withSpan: vi.fn(actual.withSpan) }
})

beforeAll(async () => {
  await import("@/app/dispatch/page")
})

const readingBoard = `/dispatch?dealership=${reading.id}`

beforeEach(() => {
  // Tuesday 2026-10-13, 09:30 in Reading (BST). Only Date is faked; timers stay real for the UI.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

/** The API under contention: the first booking wins, every other one finds the slot taken. */
function contendedApi(extra: { serverErrorAt?: number } = {}) {
  let count = 0
  let winner = false
  return mockBoardApi({
    book: (_, body) => {
      const index = count++
      if (index === extra.serverErrorAt) return new Response("", { status: 503, statusText: "Service Unavailable" })
      if (!winner) {
        winner = true
        return bookedFrom(body)
      }
      return problemResponse(409, {
        type: "https://api.keyloop.example/problems/slot-unavailable",
        title: "Slot unavailable",
        status: 409,
        detail: "Every qualified bay or technician is busy at 10:15.",
        traceId: `00-${String(index).padStart(32, "0")}-00f067aa0ba902b7-01`,
        suggestedSlots: [],
      })
    },
  })
}

async function panel() {
  return screen.findByRole("region", { name: "Concurrency test" })
}

async function aimAtInterim1015(scope: HTMLElement, requests: string) {
  const count = within(scope).getByRole("spinbutton", { name: "Requests" })
  fireEvent.change(count, { target: { value: requests } })
  fireEvent.click(within(scope).getByRole("combobox", { name: "Service" }))
  pointerClick(await screen.findByRole("option", { name: /^Interim Service/ }))
  const chip = await within(scope).findByRole("radio", { name: /^10:15/ })
  fireEvent.click(chip)
  await waitFor(() => expect(chip).toHaveAttribute("aria-checked", "true"))
}

const bookings = (requests: readonly Request[]) =>
  requests.filter((request) => request.method === "POST" && new URL(request.url).pathname.endsWith("/appointments"))

describe("concurrency stress panel", () => {
  it("fires N bookings at one slot at once, tallies 1 booked and N-1 taken with 0 server errors, and refreshes the board", async () => {
    const api = contendedApi()
    renderBoard(readingBoard)
    const scope = await panel()
    expect(within(scope).getByRole("spinbutton", { name: "Requests" })).toHaveValue(30)

    await aimAtInterim1015(scope, "5")
    const schedulesBefore = requestsTo(api.requests, "/schedule").length
    fireEvent.click(within(scope).getByRole("button", { name: "Fire 5 parallel bookings" }))

    const tally = await within(scope).findByRole("region", { name: "Tally" })
    await waitFor(() => expect(within(tally).getByRole("group", { name: "Booked" })).toHaveTextContent("1"))
    expect(within(tally).getByRole("group", { name: "Slot taken" })).toHaveTextContent("4")
    expect(within(tally).getByRole("group", { name: "Server error" })).toHaveTextContent("0")
    expect(within(tally).getByText("201 Created")).toBeInTheDocument()
    expect(within(tally).getByText("409 slot-unavailable")).toBeInTheDocument()

    // Every request, with its status, slug, duration and (for a problem) a copyable trace id.
    const results = within(scope).getByRole("table", { name: "Results" })
    const rows = within(results).getAllByRole("row").slice(1)
    expect(rows).toHaveLength(5)
    expect(rows.filter((row) => within(row).queryByText("201"))).toHaveLength(1)
    expect(rows.filter((row) => within(row).queryByText("409"))).toHaveLength(4)
    expect(within(results).getAllByRole("button", { name: "Copy trace ID" })).toHaveLength(4)

    // Five requests for the same slot, each its own customer and vehicle, none with an idempotency key.
    const sent = bookings(api.requests)
    expect(sent).toHaveLength(5)
    const bodies = await Promise.all(sent.map(async (request) => (await request.clone().json()) as BookAppointmentRequest))
    expect(new Set(bodies.map((body) => body.startUtc))).toEqual(new Set(["2026-10-13T09:15:00Z"]))
    expect(new Set(bodies.map((body) => body.vehicle.vin)).size).toBe(5)
    expect(sent.every((request) => !request.headers.has("Idempotency-Key"))).toBe(true)

    await waitFor(() => expect(requestsTo(api.requests, "/schedule").length).toBeGreaterThan(schedulesBefore))
    expect(telemetry.withSpan).toHaveBeenCalledWith("ui.stress_test", expect.any(Function), expect.any(Object))
  })

  it("counts a server error on its own tile", async () => {
    contendedApi({ serverErrorAt: 2 })
    renderBoard(readingBoard)
    const scope = await panel()
    await aimAtInterim1015(scope, "4")

    fireEvent.click(within(scope).getByRole("button", { name: "Fire 4 parallel bookings" }))

    const tally = await within(scope).findByRole("region", { name: "Tally" })
    await waitFor(() => expect(within(tally).getByRole("group", { name: "Server error" })).toHaveTextContent("1"))
    expect(within(tally).getByRole("group", { name: "Slot taken" })).toHaveTextContent("2")
  })

  it("keeps the number of requests within 2 to 50", async () => {
    mockBoardApi()
    renderBoard(readingBoard)
    const scope = await panel()
    fireEvent.change(within(scope).getByRole("spinbutton", { name: "Requests" }), { target: { value: "500" } })

    expect(await within(scope).findByText("Choose 2 to 50 requests")).toBeInTheDocument()
    expect(within(scope).getByRole("button", { name: /^Fire/ })).toBeDisabled()
  })
})

describe("concurrency stress panel on a phone", () => {
  beforeEach(() => phoneViewport())

  it("stacks the results as rows instead of a wide table", async () => {
    contendedApi()
    renderBoard(readingBoard)
    const scope = await panel()
    await aimAtInterim1015(scope, "3")

    fireEvent.click(within(scope).getByRole("button", { name: "Fire 3 parallel bookings" }))

    const results = await within(scope).findByRole("list", { name: "Results" })
    await waitFor(() => expect(within(results).getAllByRole("listitem")).toHaveLength(3))
    expect(within(scope).queryByRole("table")).not.toBeInTheDocument()
    expect(within(results).getAllByRole("button", { name: "Copy trace ID" })).toHaveLength(2)
  })
})
