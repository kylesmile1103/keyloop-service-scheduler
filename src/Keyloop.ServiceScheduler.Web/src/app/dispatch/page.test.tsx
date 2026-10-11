import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { getDealershipsQueryKey } from "@/api/@tanstack/react-query.gen"
import { defaultSchedule, mockBoardApi } from "@/test/board-api"
import { munich, reading } from "@/test/dealerships"
import { problemResponse } from "@/test/mock-api"
import { pointerClick, renderBoard, search } from "@/test/render-board"

// The board's route is lazy: load its code once up front, so each test's wait measures rendering, not the first,
// cold compile of the page's modules (about 0.4 s, more on a busy machine).
beforeAll(async () => {
  await import("@/app/dispatch/page")
})

const dealershipSelect = () => screen.findByRole("combobox", { name: "Dealership" })

/** A mouse choosing an option: Base UI selects on a click that started on the option (pointerdown, then click). */
async function choose(name: RegExp) {
  fireEvent.click(await dealershipSelect())
  pointerClick(await screen.findByRole("option", { name }))
}

describe("dispatch board: dealership", () => {
  beforeEach(() => {
    // Monday 2026-10-12, 09:00 in Reading and 10:00 in Munich. Only Date is faked; timers stay real for the UI.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-12T08:00:00Z"))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("shows that dealerships are loading until the list arrives", async () => {
    let answer: () => void = () => {}
    const held = new Promise<void>((resolve) => (answer = resolve))
    mockBoardApi({ dealerships: async () => (await held, [reading, munich]) })
    renderBoard()

    expect(await dealershipSelect()).toHaveAttribute("data-disabled")
    expect(screen.getByRole("status")).toHaveTextContent("Loading dealerships")

    answer()

    await waitFor(() => expect(screen.queryByText("Loading dealerships…")).not.toBeInTheDocument())
    expect(await dealershipSelect()).not.toHaveAttribute("data-disabled")
  })

  it("loads the dealerships from the API and offers each one with its time zone", async () => {
    const api = mockBoardApi()
    renderBoard()
    await screen.findByRole("heading", { level: 2, name: reading.name })

    fireEvent.click(await dealershipSelect())

    const options = await screen.findAllByRole("option")
    expect(options.map((option) => option.textContent)).toEqual([
      "Keyloop Motors ReadingEurope/London",
      "Keyloop Autohaus MünchenEurope/Berlin",
    ])
    // StrictMode's remount cancels the first request and sends it again, so count destinations, not requests.
    expect(new Set(api.requests.map((request) => new URL(request.url).pathname))).toContain("/api/v1/dealerships")
  })

  it("selects the first dealership and records it in the address without adding a history entry", async () => {
    mockBoardApi()
    const { router } = renderBoard()

    expect(await screen.findByRole("heading", { level: 2, name: reading.name })).toBeInTheDocument()
    expect(await dealershipSelect()).toHaveTextContent(reading.name)
    await waitFor(() => expect(search(router)).toEqual({ dealership: reading.id }))
    expect(router.state.historyAction).toBe("REPLACE")
  })

  it("opens on the first dealership with appointments today when the address names none, not on an empty one", async () => {
    // The API lists dealerships by name, so München comes first; it has no demo appointments.
    mockBoardApi({ dealerships: () => [munich, reading] })
    const { router } = renderBoard()

    expect(await screen.findByRole("heading", { level: 2, name: reading.name })).toBeInTheDocument()
    await waitFor(() => expect(search(router)).toEqual({ dealership: reading.id }))
    expect(router.state.historyAction).toBe("REPLACE")
  })

  it("falls back to the first dealership open today, then to the first one, when nobody has appointments", async () => {
    // Saturday 2026-10-17: München is closed, Reading opens until 13:00; neither has appointments.
    vi.setSystemTime(new Date("2026-10-17T08:00:00Z"))
    const empty = (schedule: ReturnType<typeof defaultSchedule>) => ({ ...schedule, bays: schedule.bays.map((bay) => ({ ...bay, appointments: [] })) })
    mockBoardApi({
      dealerships: () => [munich, reading],
      schedule: (dealershipId, date) =>
        dealershipId === munich.id ? { ...empty(defaultSchedule(dealershipId, date)), operatingWindow: null } : empty(defaultSchedule(dealershipId, date)),
    })
    renderBoard()

    expect(await screen.findByRole("heading", { level: 2, name: reading.name })).toBeInTheDocument()
  })

  it("opens the dealership the address names", async () => {
    mockBoardApi()
    const { router } = renderBoard(`/dispatch?dealership=${munich.id}`)

    expect(await screen.findByRole("heading", { level: 2, name: munich.name })).toBeInTheDocument()
    expect(await dealershipSelect()).toHaveTextContent(munich.name)
    expect(search(router)).toEqual({ dealership: munich.id })
  })

  it("switches dealership from the select, keeping the rest of the address", async () => {
    mockBoardApi()
    const { router } = renderBoard("/dispatch?date=2026-10-13")
    await screen.findByRole("heading", { level: 2, name: reading.name })

    await choose(/München/)

    expect(await screen.findByRole("heading", { level: 2, name: munich.name })).toBeInTheDocument()
    expect(search(router)).toEqual({ date: "2026-10-13", dealership: munich.id })
    expect(router.state.historyAction).toBe("PUSH")
  })

  it("can be operated from the keyboard alone", async () => {
    mockBoardApi()
    const { router } = renderBoard()
    await screen.findByRole("heading", { level: 2, name: reading.name })
    const trigger = await dealershipSelect()

    trigger.focus()
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    const listbox = await screen.findByRole("listbox")
    await waitFor(() => expect(document.activeElement).toHaveTextContent(reading.name))
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" })
    await waitFor(() => expect(document.activeElement).toHaveTextContent(munich.name))
    fireEvent.keyDown(document.activeElement!, { key: "Enter" })

    // Closed, with focus back on the select. (jsdom never ends the exit animation, so the list stays mounted, hidden.)
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"))
    expect(listbox.closest("[data-closed]")).not.toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(await screen.findByRole("heading", { level: 2, name: munich.name })).toBeInTheDocument()
    expect(search(router)).toEqual({ dealership: munich.id })
  })

  it("says so when the address names a dealership that does not exist, and shows the first one instead", async () => {
    mockBoardApi()
    const { router } = renderBoard("/dispatch?dealership=00000000-0000-0000-0000-000000000000")

    expect(await screen.findAllByText("Dealership not found")).toHaveLength(1)
    expect(screen.getByText(`The link named a dealership that does not exist. Showing ${reading.name}.`)).toBeInTheDocument()
    expect(await screen.findByRole("heading", { level: 2, name: reading.name })).toBeInTheDocument()
    await waitFor(() => expect(search(router)).toEqual({ dealership: reading.id }))
  })

  it("reports a stale link once when the list is already loaded, as on returning to the board", async () => {
    mockBoardApi()
    renderBoard("/dispatch?dealership=00000000-0000-0000-0000-000000000000", { cached: [reading, munich] })

    expect(await screen.findByRole("heading", { level: 2, name: reading.name })).toBeInTheDocument()
    expect(await screen.findAllByText("Dealership not found")).toHaveLength(1)
  })

  it("shows the selected dealership's opening hours for today in its own time zone", async () => {
    mockBoardApi()
    renderBoard(`/dispatch?dealership=${munich.id}`)

    expect(await screen.findByText("Open today 07:30–18:30 (Europe/Berlin).")).toBeInTheDocument()
  })

  it("says when the selected dealership is closed today", async () => {
    vi.setSystemTime(new Date("2026-10-17T09:00:00Z")) // Saturday: Reading opens, Munich does not
    mockBoardApi()
    renderBoard(`/dispatch?dealership=${munich.id}`)

    expect(await screen.findByText("Closed today (Europe/Berlin).")).toBeInTheDocument()
  })

  it("goes by the dealership's own calendar day near midnight, not the browser's", async () => {
    vi.setSystemTime(new Date("2026-10-16T22:30:00Z")) // Friday 23:30 in Reading, already Saturday 00:30 in Munich
    mockBoardApi()
    renderBoard(`/dispatch?dealership=${munich.id}`)

    expect(await screen.findByText("Closed today (Europe/Berlin).")).toBeInTheDocument()
  })

  it("keeps the board when a background refresh fails", async () => {
    let failing = false
    mockBoardApi({ dealerships: () => (failing ? new Response("", { status: 503 }) : [reading, munich]) })
    const { queryClient } = renderBoard()
    await screen.findByRole("heading", { level: 2, name: reading.name })

    failing = true
    await act(() => queryClient.refetchQueries())
    await waitFor(() => expect(queryClient.getQueryState(getDealershipsQueryKey())?.status).toBe("error"))

    expect(screen.getByRole("heading", { level: 2, name: reading.name })).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("explains an empty list and checks again on request", async () => {
    const api = mockBoardApi({ dealerships: () => [] })
    const { router } = renderBoard()

    expect(await screen.findByRole("heading", { level: 2, name: "No dealerships yet" })).toBeInTheDocument()
    expect(await dealershipSelect()).toHaveAttribute("data-disabled")
    expect(await dealershipSelect()).toHaveTextContent("No dealerships")
    expect(search(router)).toEqual({})

    const before = api.requests.length
    fireEvent.click(screen.getByRole("button", { name: "Check again" }))

    await waitFor(() => expect(api.requests).toHaveLength(before + 1))
  })

  it("shows the API's explanation and trace id when loading fails, and loads the list on retry", async () => {
    let failing = true
    mockBoardApi({
      dealerships: () =>
        failing
          ? problemResponse(429, {
            type: "https://api.keyloop.example/problems/rate-limited",
            title: "Too many requests",
            status: 429,
            detail: "Too many requests from this client. Retry after 3 seconds.",
            traceId: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            retryAfterSeconds: 3,
            })
          : [reading, munich],
    })
    renderBoard()

    const alert = await screen.findByRole("alert")
    expect(within(alert).getByText("Couldn’t load dealerships")).toBeInTheDocument()
    expect(within(alert).getByText("Too many requests from this client. Retry after 3 seconds.")).toBeInTheDocument()
    expect(within(alert).getByText("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")).toBeInTheDocument()
    expect(await dealershipSelect()).toHaveAttribute("data-disabled")
    expect(await dealershipSelect()).toHaveTextContent("Dealerships unavailable")

    failing = false
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }))

    expect(await screen.findByRole("heading", { level: 2, name: reading.name })).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("names the status when a failure carries no explanation", async () => {
    mockBoardApi({ dealerships: () => new Response("", { status: 500, statusText: "Internal Server Error" }) })
    renderBoard()

    const alert = await screen.findByRole("alert")
    expect(within(alert).getByText("The server answered 500 Internal Server Error without details.")).toBeInTheDocument()
  })

  it("copies the trace id", async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })
    mockBoardApi({ dealerships: () => problemResponse(429, { title: "Too many requests", status: 429, traceId: "00-abc-def-01" }) })
    renderBoard()

    fireEvent.click(await screen.findByRole("button", { name: "Copy trace ID" }))

    expect(writeText).toHaveBeenCalledWith("00-abc-def-01")
    expect(await screen.findByRole("button", { name: "Trace ID copied" })).toBeInTheDocument()
  })
})
