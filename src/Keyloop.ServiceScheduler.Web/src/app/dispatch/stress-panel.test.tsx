import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { BookAppointmentRequest, WorkshopScheduleResponse } from "@/api/types.gen"
import * as telemetry from "@/lib/telemetry"
import { bookedFrom, mockBoardApi, requestsTo, scheduledFrom } from "@/test/board-api"
import { munich, reading } from "@/test/dealerships"
import { expectAvailable, expectUnavailableButFocusable } from "@/test/focus"
import { problemResponse } from "@/test/mock-api"
import { phoneViewport, pointerClick, renderBoard, search } from "@/test/render-board"
import { availabilityOn, readingTuesday } from "@/test/schedules"

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

/**
 * The API under contention: the first booking wins, every other one finds the slot taken. The winner then shows on
 * Tuesday's board, under Bay 1.
 */
function contendedApi(extra: { serverErrorAt?: number } = {}) {
  let count = 0
  let winner: WorkshopScheduleResponse | null = null
  return mockBoardApi({
    schedule: (_, date) => (date === readingTuesday.date && winner) || { ...readingTuesday, date },
    availability: (_, __, date) => availabilityOn(date),
    book: (_, body) => {
      const index = count++
      if (index === extra.serverErrorAt) return new Response("", { status: 503, statusText: "Service Unavailable" })
      if (!winner) {
        const appointment = bookedFrom(body)
        winner = {
          ...readingTuesday,
          bays: readingTuesday.bays.map((bay, position) =>
            position === 0 ? { ...bay, appointments: [...bay.appointments, scheduledFrom(appointment)] } : bay
          ),
        }
        return appointment
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
  await pick1015(scope)
}

/** The 10:15 chip of the day the panel shows. */
async function pick1015(scope: HTMLElement) {
  const chip = await within(scope).findByRole("radio", { name: /^10:15/ })
  fireEvent.click(chip)
  await waitFor(() => expect(chip).toHaveAttribute("aria-checked", "true"))
}

const bookings = (requests: readonly Request[]) =>
  requests.filter((request) => request.method === "POST" && new URL(request.url).pathname.endsWith("/appointments"))

/** Fire cannot fire, says why, and stays focusable. */
function expectCannotFire(fire: HTMLElement, because: string) {
  expectUnavailableButFocusable(fire)
  expect(fire).toHaveAccessibleDescription(because)
}

function expectCanFire(fire: HTMLElement) {
  expectAvailable(fire)
  expect(fire).not.toHaveAccessibleDescription()
}

describe("concurrency stress panel", () => {
  it("fires N bookings at one slot at once, tallies 1 booked and N-1 taken with 0 server errors, and refreshes the board", async () => {
    const api = contendedApi()
    renderBoard(readingBoard)
    const scope = await panel()
    expect(within(scope).getByRole("spinbutton", { name: "Requests" })).toHaveValue(30)

    await aimAtInterim1015(scope, "5")
    const schedulesBefore = requestsTo(api.requests, "/schedule").length
    const availabilityBefore = requestsTo(api.requests, "/availability").length
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
    // The day's free starts are read again too: the won slot is gone from the chips and the next free slot.
    await waitFor(() => expect(requestsTo(api.requests, "/availability").length).toBeGreaterThan(availabilityBefore))
    expect(telemetry.withSpan).toHaveBeenCalledWith("ui.stress_test", expect.any(Function), expect.any(Object))

    // The one winner is on the board, with the booked halo.
    const block = await screen.findByRole("button", { name: /^Interim Service, Bay 1 - Standard, 10:15 to 11:15/ })
    await waitFor(() => expect(block).toHaveAttribute("data-booked"))
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

  it("aims only at the board's day: another day clears the chosen slot, and the next one fires at that day", async () => {
    const api = contendedApi()
    const { router } = renderBoard(readingBoard)
    const scope = await panel()
    await aimAtInterim1015(scope, "3")

    fireEvent.click(screen.getByRole("button", { name: "Next day" }))

    await waitFor(() => expect(search(router).date).toBe("2026-10-14"))
    // Wednesday's chips, none chosen, and nothing to fire at until one is.
    await waitFor(() => expect(within(scope).getByRole("radio", { name: /^10:15/ })).toHaveAttribute("aria-checked", "false"))
    expectCannotFire(within(scope).getByRole("button", { name: "Fire 3 parallel bookings" }), "Choose a free start first.")
    // The count and the service stay: they do not depend on the day.
    expect(within(scope).getByRole("spinbutton", { name: "Requests" })).toHaveValue(3)
    expect(within(scope).getByRole("combobox", { name: "Service" })).toHaveTextContent("Interim Service")

    await pick1015(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Fire 3 parallel bookings" }))

    await waitFor(() => expect(bookings(api.requests)).toHaveLength(3))
    const bodies = await Promise.all(bookings(api.requests).map(async (request) => (await request.clone().json()) as BookAppointmentRequest))
    expect(new Set(bodies.map((body) => body.startUtc))).toEqual(new Set(["2026-10-14T09:15:00Z"]))
  })

  it("forgets the service and the slot when the board moves to another dealership", async () => {
    contendedApi()
    // München first, so its catalogue (which lists the same Interim Service) is already loaded when the board returns to it.
    renderBoard(`/dispatch?dealership=${munich.id}`)
    const scope = await panel()
    const service = within(scope).getByRole("combobox", { name: "Service" })
    await waitFor(() => expect(service).not.toHaveAttribute("aria-busy"))
    const chooseDealership = async (name: RegExp) => {
      fireEvent.click(screen.getByRole("combobox", { name: "Dealership" }))
      pointerClick(await screen.findByRole("option", { name }))
    }
    await chooseDealership(/Reading/)
    await screen.findByRole("heading", { level: 2, name: reading.name })
    await aimAtInterim1015(scope, "3")

    await chooseDealership(/München/)

    await screen.findByRole("heading", { level: 2, name: munich.name })
    expect(service).toHaveTextContent("Choose a service")
    expectCannotFire(within(scope).getByRole("button", { name: "Fire 3 parallel bookings" }), "Choose a service and a free start first.")
  })

  it("keeps the last run's results with the day it ran on", async () => {
    contendedApi()
    renderBoard(readingBoard)
    const scope = await panel()
    await aimAtInterim1015(scope, "3")
    fireEvent.click(within(scope).getByRole("button", { name: "Fire 3 parallel bookings" }))
    await waitFor(() => expect(within(scope).getByRole("group", { name: "Booked" })).toHaveTextContent("1"))

    fireEvent.click(screen.getByRole("button", { name: "Next day" }))
    await waitFor(() => expect(within(scope).queryByRole("region", { name: "Tally" })).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: "Previous day" }))
    expect(await within(scope).findByRole("region", { name: "Tally" })).toBeInTheDocument()
  })

  it("keeps a start chosen on another day while a run was still out", async () => {
    let answer: () => void = () => {}
    const held = new Promise<void>((resolve) => (answer = resolve))
    mockBoardApi({
      availability: (_, __, date) => availabilityOn(date),
      book: async (_, body) => (await held, bookedFrom(body)),
    })
    renderBoard(readingBoard)
    const scope = await panel()
    await aimAtInterim1015(scope, "2")
    fireEvent.click(within(scope).getByRole("button", { name: "Fire 2 parallel bookings" }))
    await within(scope).findByRole("button", { name: "Firing…" })

    fireEvent.click(screen.getByRole("button", { name: "Next day" }))
    await pick1015(scope)
    answer()

    // The run spent Tuesday's start, not the one chosen on Wednesday since.
    await waitFor(() => expectCanFire(within(scope).getByRole("button", { name: "Fire 2 parallel bookings" })))
    expect(within(scope).getByRole("radio", { name: /^10:15/ })).toHaveAttribute("aria-checked", "true")
  })

  it("keeps keyboard focus on Fire through the run and after it, and a press while it cannot fire sends nothing", async () => {
    let answer: () => void = () => {}
    const held = new Promise<void>((resolve) => (answer = resolve))
    const api = mockBoardApi({
      availability: (_, __, date) => availabilityOn(date),
      book: async (_, body) => (await held, bookedFrom(body)),
    })
    renderBoard(readingBoard)
    const scope = await panel()
    await aimAtInterim1015(scope, "2")
    const fire = within(scope).getByRole("button", { name: "Fire 2 parallel bookings" })
    fire.focus()
    fireEvent.click(fire)

    // While the run is out: the same button, still holding focus, unavailable without the `disabled` attribute.
    await waitFor(() => expect(fire).toHaveAccessibleName("Firing…"))
    expect(fire).toHaveFocus()
    expectUnavailableButFocusable(fire)
    expect(fire).toHaveAttribute("aria-busy", "true")
    fireEvent.click(fire)
    expect(bookings(api.requests)).toHaveLength(2)

    answer()
    await within(scope).findByText(/^2 requests answered/)

    // The run spent its start, so Fire waits for the next one, and the keyboard user is still on it.
    expect(fire).toHaveAccessibleName("Fire 2 parallel bookings")
    expect(fire).toHaveFocus()
    expect(document.activeElement).not.toBe(document.body)
    expectCannotFire(fire, "Choose a free start first.")
    fireEvent.click(fire)
    fireEvent.keyDown(fire, { key: "Enter" })
    expect(bookings(api.requests)).toHaveLength(2)

    await pick1015(scope)
    expectCanFire(fire)
  })

  it("takes no bookings on a past day", async () => {
    mockBoardApi()
    renderBoard(`${readingBoard}&date=2026-10-12`)
    const scope = await panel()
    fireEvent.click(within(scope).getByRole("combobox", { name: "Service" }))
    pointerClick(await screen.findByRole("option", { name: /^Interim Service/ }))

    expect(await within(scope).findByText("Past days take no bookings: choose today or a later day on the board.")).toBeInTheDocument()
    expect(within(scope).queryByRole("radio")).not.toBeInTheDocument()
    expectCannotFire(
      within(scope).getByRole("button", { name: "Fire 30 parallel bookings" }),
      "Past days take no bookings: choose today or a later day on the board."
    )
  })

  it("says in the screen's words which days take bookings when the board is past the booking horizon", async () => {
    mockBoardApi({
      availability: () =>
        problemResponse(400, {
          type: "https://api.keyloop.example/problems/validation-error",
          title: "Validation failed",
          status: 400,
          detail: "One or more fields are invalid.",
          traceId: "00-6af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
          errors: { date: ["date must be between 2026-10-12 and 2027-01-10."] },
        }),
    })
    renderBoard(`${readingBoard}&date=2027-03-02`)
    const scope = await panel()
    fireEvent.click(within(scope).getByRole("combobox", { name: "Service" }))
    pointerClick(await screen.findByRole("option", { name: /^Interim Service/ }))

    expect(await within(scope).findByText("Date must be between 2026-10-12 and 2027-01-10.")).toBeInTheDocument()
    expect(within(scope).queryByRole("alert")).not.toBeInTheDocument()
  })

  it("says so when the run itself fails, and lets the next one start", async () => {
    contendedApi()
    vi.mocked(telemetry.withSpan).mockImplementationOnce(async () => {
      throw new Error("The tracer could not start a span.")
    })
    renderBoard(readingBoard)
    const scope = await panel()
    await aimAtInterim1015(scope, "3")

    fireEvent.click(within(scope).getByRole("button", { name: "Fire 3 parallel bookings" }))

    const alert = await within(scope).findByRole("alert")
    expect(within(alert).getByText("The concurrency test stopped")).toBeInTheDocument()
    expect(within(scope).queryByRole("button", { name: "Firing…" })).not.toBeInTheDocument()
    await pick1015(scope)
    expectCanFire(within(scope).getByRole("button", { name: "Fire 3 parallel bookings" }))
  })

  it("keeps the number of requests within 2 to 50", async () => {
    mockBoardApi()
    renderBoard(readingBoard)
    const scope = await panel()
    fireEvent.change(within(scope).getByRole("spinbutton", { name: "Requests" }), { target: { value: "500" } })

    expect(await within(scope).findByText("Choose 2 to 50 requests")).toBeInTheDocument()
    expectCannotFire(within(scope).getByRole("button", { name: /^Fire/ }), "Choose 2 to 50 requests")
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
