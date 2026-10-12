import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { getDealershipsQueryKey } from "@/api/@tanstack/react-query.gen"
import { defaultSchedule, mockBoardApi } from "@/test/board-api"
import { munich, reading } from "@/test/dealerships"
import { expectAvailable, expectUnavailableButFocusable } from "@/test/focus"
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

  const emptied = (schedule: ReturnType<typeof defaultSchedule>) => ({ ...schedule, bays: schedule.bays.map((bay) => ({ ...bay, appointments: [] })) })
  /** München's day with work on it: Reading's booked bays under München's name (only the bookings matter here). */
  const munichBooked = (date: string) => ({ ...defaultSchedule(munich.id, date), bays: defaultSchedule(reading.id, date).bays })

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
    mockBoardApi({
      dealerships: () => [munich, reading],
      schedule: (dealershipId, date) =>
        dealershipId === munich.id ? { ...emptied(defaultSchedule(dealershipId, date)), operatingWindow: null } : emptied(defaultSchedule(dealershipId, date)),
    })
    renderBoard()

    expect(await screen.findByRole("heading", { level: 2, name: reading.name })).toBeInTheDocument()
  })

  // Monday 2026-10-12: both dealerships open today, and their next open day is Tuesday the 13th.
  it("prefers a dealership with appointments today over one booked only on its next open day", async () => {
    mockBoardApi({
      dealerships: () => [munich, reading],
      schedule: (dealershipId, date) =>
        dealershipId === munich.id
          ? date === "2026-10-13"
            ? munichBooked(date)
            : defaultSchedule(dealershipId, date)
          : defaultSchedule(dealershipId, date),
    })
    renderBoard()

    expect(await screen.findByRole("heading", { level: 2, name: reading.name })).toBeInTheDocument()
  })

  it("prefers a dealership with appointments on its next open day over one that is merely open today", async () => {
    mockBoardApi({
      dealerships: () => [munich, reading],
      schedule: (dealershipId, date) =>
        dealershipId === reading.id && date === "2026-10-12" ? emptied(defaultSchedule(dealershipId, date)) : defaultSchedule(dealershipId, date),
    })
    renderBoard()

    expect(await screen.findByRole("heading", { level: 2, name: reading.name })).toBeInTheDocument()
  })

  it("keeps the loading frame until the schedules it compares have arrived, never showing or recording the first one", async () => {
    let answer: () => void = () => {}
    const held = new Promise<void>((resolve) => (answer = resolve))
    mockBoardApi({
      dealerships: () => [munich, reading],
      schedule: async (dealershipId, date) => (await held, defaultSchedule(dealershipId, date)),
    })
    const { router } = renderBoard()

    expect(await screen.findByText("Finding a dealership with work today…")).toBeInTheDocument()
    expect(await dealershipSelect()).not.toHaveTextContent(munich.name)
    expect(screen.queryByRole("heading", { level: 2, name: munich.name })).not.toBeInTheDocument()
    expect(search(router)).toEqual({})

    answer()

    expect(await screen.findByRole("heading", { level: 2, name: reading.name })).toBeInTheDocument()
    await waitFor(() => expect(search(router)).toEqual({ dealership: reading.id }))
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
    let answer: () => void = () => {}
    let held: Promise<void> | null = null
    const api = mockBoardApi({ dealerships: async () => (await held, []) })
    const { router } = renderBoard()

    expect(await screen.findByRole("heading", { level: 2, name: "No dealerships yet" })).toBeInTheDocument()
    expect(await dealershipSelect()).toHaveAttribute("data-disabled")
    expect(await dealershipSelect()).toHaveTextContent("No dealerships")
    expect(search(router)).toEqual({})

    const before = api.requests.length
    held = new Promise<void>((resolve) => (answer = resolve))
    const checkAgain = screen.getByRole("button", { name: "Check again" })
    checkAgain.focus()
    fireEvent.click(checkAgain)

    await waitFor(() => expect(api.requests).toHaveLength(before + 1))
    // While it checks, and once the list is still empty, the keyboard user stays on Check again.
    await waitFor(() => expectUnavailableButFocusable(checkAgain))
    expect(checkAgain).toHaveFocus()
    answer()
    await waitFor(() => expectAvailable(checkAgain))
    expect(checkAgain).toHaveFocus()
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

  it("keeps the failure and keyboard focus on Try again while the list is read again, and after it fails again", async () => {
    let answer: () => void = () => {}
    let held: Promise<void> | null = null
    const api = mockBoardApi({
      dealerships: async () => {
        await held
        return problemResponse(503, { title: "Service unavailable", status: 503, detail: "The dealership service is unavailable." })
      },
    })
    renderBoard()

    const alert = await screen.findByRole("alert")
    const explanation = within(alert).getByText("The dealership service is unavailable.")
    const tryAgain = within(alert).getByRole("button", { name: "Try again" })
    expectAvailable(tryAgain)

    const before = api.requests.length
    held = new Promise<void>((resolve) => (answer = resolve))
    tryAgain.focus()
    fireEvent.click(tryAgain)

    await waitFor(() => expect(api.requests).toHaveLength(before + 1))
    // While it reads again the failure stays, not the loading frame: the keyboard user stays on Try again, which cannot
    // act meanwhile, and the select still says why it is empty.
    expect(tryAgain).toBeInTheDocument()
    expectUnavailableButFocusable(tryAgain)
    expect(tryAgain).toHaveFocus()
    expect(explanation).toBeInTheDocument()
    expect(screen.queryByText("Loading dealerships…")).not.toBeInTheDocument()
    expect(await dealershipSelect()).toHaveTextContent("Dealerships unavailable")
    fireEvent.click(tryAgain)

    answer()
    await waitFor(() => expectAvailable(tryAgain))
    expect(tryAgain).toHaveFocus()
    // The same words again, but as new content in the alert, so a screen reader reads the second failure out too.
    expect(explanation).not.toBeInTheDocument()
    expect(within(alert).getByText("The dealership service is unavailable.")).toBeInTheDocument()
    // The press while it read sent nothing.
    expect(api.requests).toHaveLength(before + 1)
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
