import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { AvailabilityResponse } from "@/api/types.gen"
import { mockBoardApi, requestsTo } from "@/test/board-api"
import { munich, reading } from "@/test/dealerships"
import { problemResponse } from "@/test/mock-api"
import { boardHeading, pointerClick, renderBoard, search } from "@/test/render-board"
import {
  appointments,
  bays,
  fullServiceType,
  interimAvailability,
  interimDetails,
  interimServiceType,
  readingTuesday,
  without,
  withStatus,
} from "@/test/schedules"

// The board's route is lazy: load its code once up front, so each test's wait measures rendering, not the first compile.
beforeAll(async () => {
  await import("@/app/dispatch/page")
})

const readingBoard = `/dispatch?dealership=${reading.id}`
const interimLabel = "Interim Service, Bay 1 - Standard, 08:00 to 09:00, Amelia Clarke, Confirmed"
const scheduleDates = (requests: readonly Request[]) =>
  requestsTo(requests, "/schedule").map((request) => new URL(request.url).searchParams.get("date"))
const lane = (name: string) => screen.findByRole("group", { name: new RegExp(`^${name}`) })
const block = (name: string) => screen.findByRole("button", { name })

/** Reading's availability on 2026-10-13 with free starts at these UTC instants, each as long as the service. */
function availabilityAt(durationMinutes: number, ...starts: string[]): AvailabilityResponse {
  const at = (instant: number) => new Date(instant).toISOString().replace(".000Z", "Z")
  return {
    ...interimAvailability,
    durationMinutes,
    slots: starts.map((startUtc) => ({
      startUtc,
      endUtc: at(Date.parse(startUtc) + durationMinutes * 60_000),
      // British Summer Time: UTC+1.
      startLocal: `${at(Date.parse(startUtc) + 3_600_000).slice(0, 16)}+01:00`,
      freeBays: 2,
      freeTechnicians: 2,
    })),
  }
}

beforeEach(() => {
  // Tuesday 2026-10-13, 09:30 in Reading (BST). Only Date is faked; timers stay real for the UI.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

describe("dispatch board: timeline", () => {
  it("draws each bay as a lane with its appointments in the columns of their local times", async () => {
    const api = mockBoardApi()
    renderBoard(readingBoard)

    const bay1 = await lane("Bay 1 - Standard")
    expect(within(bay1).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      interimLabel,
      "Brake Pads & Discs, Bay 1 - Standard, 10:30 to 12:00, Chloe Nguyen, Confirmed",
      "Full Service, Bay 1 - Standard, 13:00 to 15:00, Daniel Moss, Confirmed",
    ])
    // The lane column is grid line 1; time starts at line 2 (08:00), one line per 15 minutes.
    expect(await block(interimLabel)).toHaveStyle({ gridColumn: "2 / 6" })
    expect(within(bay1).getByRole("button", { name: /^Brake Pads/ })).toHaveStyle({ gridColumn: "12 / 18" })
    expect(within(await lane("Bay 4 - EV")).getByRole("button")).toHaveStyle({ gridColumn: "6 / 10" })
    expect(within(await lane("Bay 3 - Heavy duty")).queryAllByRole("button")).toEqual([])
    // Today in Reading, asked for in the dealership's calendar.
    expect(new Set(scheduleDates(api.requests))).toEqual(new Set(["2026-10-13"]))
  })

  it("labels the ruler with the dealership's whole local hours, widening a half-hour opening to the hour and hatching it", async () => {
    mockBoardApi()
    renderBoard(`/dispatch?dealership=${munich.id}`)
    await boardHeading(munich.name)

    // The ruler is decorative (every block names its own times); its labels are the hours on the dealership's clock.
    await lane("Halle 1")
    const ruler = [...document.querySelectorAll('[data-slot="hour-label"]')]
    expect(ruler.map((cell) => cell.textContent)).toEqual([
      "07:00",
      "08:00",
      "09:00",
      "10:00",
      "11:00",
      "12:00",
      "13:00",
      "14:00",
      "15:00",
      "16:00",
      "17:00",
      "18:00",
    ])
    // 07:00–07:30 and 18:30–19:00 are drawn but closed: two hatched runs of two 15-minute columns out of 48.
    const closed = [...document.querySelectorAll<HTMLElement>('[data-slot="closed-time"]')]
    expect(closed.map((run) => [run.style.left, run.style.width])).toEqual([
      ["0%", "4.17%"],
      ["95.83%", "4.17%"],
    ])
  })

  it("marks now on today's board, and not on another day's", async () => {
    mockBoardApi()
    const { router } = renderBoard(readingBoard)
    await lane("Bay 1 - Standard")

    // 08:30Z is 1.5 of the board's ten hours (07:00–17:00Z).
    expect(document.querySelector('[data-slot="now-line"]')).toHaveStyle({ left: "15%" })
    const label = document.querySelector('[data-slot="now-label"]')
    expect(label).toHaveStyle({ left: "15%" })
    expect(label).toHaveTextContent("09:30")

    fireEvent.click(screen.getByRole("button", { name: "Next day" }))
    await waitFor(() => expect(search(router).date).toBe("2026-10-14"))
    await waitFor(() => expect(document.querySelector('[data-slot="now-line"]')).toBeNull())
  })

  it("shows the technicians as lanes, each with their work from every bay", async () => {
    const api = mockBoardApi()
    const { router } = renderBoard(readingBoard)
    await lane("Bay 1 - Standard")

    fireEvent.click(screen.getByRole("tab", { name: "Technicians" }))

    const chloe = await lane("Chloe Nguyen")
    expect(within(chloe).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Brake Pads & Discs, Bay 1 - Standard, 10:30 to 12:00, Chloe Nguyen, Confirmed",
      "Four-Wheel Alignment, Bay 2 - Alignment, 15:00 to 15:45, Chloe Nguyen, Confirmed",
    ])
    expect(within(chloe).getAllByRole("button")[1]).toHaveStyle({ gridColumn: "30 / 33" })
    expect(within(await lane("Eva Lindqvist")).queryAllByRole("button")).toEqual([])
    expect(screen.queryByRole("group", { name: /^Bay 1/ })).not.toBeInTheDocument()
    expect(search(router)).toEqual({ dealership: reading.id, lanes: "technicians" })
    // A view of the same day, not a new place: Back leaves the board instead of flipping the lanes.
    expect(router.state.historyAction).toBe("REPLACE")
    // One schedule serves both views.
    expect(new Set(scheduleDates(api.requests))).toEqual(new Set(["2026-10-13"]))
  })

  it("opens in the lane view the address names", async () => {
    mockBoardApi()
    renderBoard(`${readingBoard}&lanes=technicians`)

    expect(await lane("Amelia Clarke")).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Technicians" })).toHaveAttribute("aria-selected", "true")
  })

  it("keeps a bay that is out of service as a lane, and says so", async () => {
    mockBoardApi({
      schedule: () => ({
        ...readingTuesday,
        bays: readingTuesday.bays.map((bay) => (bay.id === bays.heavy.id ? { ...bay, isActive: false } : bay)),
      }),
    })
    renderBoard(readingBoard)

    expect(await lane("Bay 3 - Heavy duty")).toHaveAccessibleName(/out of service/i)
    expect(await lane("Bay 1 - Standard")).not.toHaveAccessibleName(/out of service/i)
  })

  it("names each bay's equipment", async () => {
    mockBoardApi()
    renderBoard(readingBoard)

    const bay4 = await lane("Bay 4 - EV")
    expect(within(bay4).getByText("EV high voltage")).toBeInTheDocument()
  })
})

describe("dispatch board: day, lanes and refresh", () => {
  it("moves to the next and previous day, and back to today", async () => {
    const api = mockBoardApi()
    const { router } = renderBoard(readingBoard)
    await lane("Bay 1 - Standard")
    expect(screen.getByRole("button", { name: "Today" })).toBeDisabled()

    fireEvent.click(screen.getByRole("button", { name: "Next day" }))
    await waitFor(() => expect(search(router)).toEqual({ dealership: reading.id, date: "2026-10-14" }))
    expect(router.state.historyAction).toBe("PUSH")
    await waitFor(() => expect(scheduleDates(api.requests)).toContain("2026-10-14"))
    expect(screen.getByRole("button", { name: /^Choose date/ })).toHaveTextContent("Wed 14 Oct")

    // Stepping back onto today leaves today out of the address again.
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }))
    await waitFor(() => expect(search(router)).toEqual({ dealership: reading.id }))
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }))
    await waitFor(() => expect(search(router).date).toBe("2026-10-12"))

    fireEvent.click(screen.getByRole("button", { name: "Today" }))
    await waitFor(() => expect(search(router)).toEqual({ dealership: reading.id }))
  })

  it("picks a date from the calendar", async () => {
    const api = mockBoardApi()
    const { router } = renderBoard(readingBoard)
    await lane("Bay 1 - Standard")

    fireEvent.click(screen.getByRole("button", { name: "Choose date, Tuesday 13 October 2026" }))
    const calendar = await screen.findByRole("dialog", { name: "Choose date" })
    fireEvent.click(within(calendar).getByRole("button", { name: /October 15th, 2026/ }))

    await waitFor(() => expect(search(router).date).toBe("2026-10-15"))
    await waitFor(() => expect(scheduleDates(api.requests)).toContain("2026-10-15"))
  })

  it("says in words, not only by striking them through, which days the calendar's dealership is closed", async () => {
    mockBoardApi()
    renderBoard(readingBoard)
    await lane("Bay 1 - Standard")

    fireEvent.click(screen.getByRole("button", { name: "Choose date, Tuesday 13 October 2026" }))
    const calendar = await screen.findByRole("dialog", { name: "Choose date" })

    // Reading closes on Sundays.
    expect(within(calendar).getByRole("button", { name: /October 18th, 2026/ })).toHaveAccessibleName(/, closed$/)
    expect(within(calendar).getByRole("button", { name: /October 15th, 2026/ })).not.toHaveAccessibleName(/closed/)
  })

  it("shows today when the address names no real date, and corrects the address", async () => {
    const api = mockBoardApi()
    const { router } = renderBoard(`${readingBoard}&date=2026-02-30`)

    await lane("Bay 1 - Standard")
    await waitFor(() => expect(search(router)).toEqual({ dealership: reading.id }))
    expect(new Set(scheduleDates(api.requests))).toEqual(new Set(["2026-10-13"]))
  })

  it("explains a closed day and offers the next open one", async () => {
    mockBoardApi()
    const { router } = renderBoard(`${readingBoard}&date=2026-10-18`)

    expect(await screen.findByRole("heading", { level: 3, name: "Closed on Sunday 18 October" })).toBeInTheDocument()
    expect(screen.getByText("The workshop opens again on Monday 19 October.")).toBeInTheDocument()
    // The headline says what the picture shows, so the illustration is decorative.
    expect(document.querySelector('img[src*="closed-day"]')).toHaveAttribute("alt", "")
    expect(screen.getByText("Closed on Sunday 18 October 2026 (Europe/London).")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Go to Monday 19 October" }))

    await waitFor(() => expect(search(router).date).toBe("2026-10-19"))
    expect(await lane("Bay 1 - Standard")).toBeInTheDocument()
  })

  it("says when nothing is booked on an open day", async () => {
    mockBoardApi()
    renderBoard(`/dispatch?dealership=${munich.id}&date=2026-10-14`)

    expect(await screen.findByRole("heading", { level: 3, name: "No appointments on Wednesday 14 October" })).toBeInTheDocument()
    expect(screen.getByText("Every bay is free all day.")).toBeInTheDocument()
    expect(document.querySelector('img[src*="empty-schedule"]')).toHaveAttribute("alt", "")
  })

  it("hides and shows lanes from the lane filter", async () => {
    mockBoardApi()
    renderBoard(readingBoard)
    await lane("Bay 3 - Heavy duty")

    fireEvent.click(screen.getByRole("button", { name: "Lanes, 6 of 6 shown" }))
    const filter = await screen.findByRole("dialog", { name: "Lanes" })
    fireEvent.click(within(filter).getByRole("checkbox", { name: "Bay 3 - Heavy duty" }))

    await waitFor(() => expect(screen.queryByRole("group", { name: /^Bay 3/ })).not.toBeInTheDocument())
    expect(screen.getByRole("button", { name: "Lanes, 5 of 6 shown" })).toBeInTheDocument()

    fireEvent.click(within(filter).getByRole("button", { name: "Show all" }))
    expect(await lane("Bay 3 - Heavy duty")).toBeInTheDocument()
  })

  it("refreshes the board and its next free slot every 5 seconds while auto-refresh is on", async () => {
    const api = mockBoardApi()
    renderBoard(readingBoard)
    await lane("Bay 1 - Standard")
    expect(await within(screen.getByRole("group", { name: "Next free slot" })).findByText("10:15")).toBeInTheDocument()
    const switchControl = screen.getByRole("switch", { name: "Auto-refresh" })
    expect(switchControl).not.toBeChecked()

    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] })
    vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
    const before = requestsTo(api.requests, "/schedule").length
    const availabilityBefore = requestsTo(api.requests, "/availability").length
    await act(() => vi.advanceTimersByTimeAsync(6000))
    expect(requestsTo(api.requests, "/schedule")).toHaveLength(before)
    expect(requestsTo(api.requests, "/availability")).toHaveLength(availabilityBefore)

    fireEvent.click(switchControl)
    expect(switchControl).toBeChecked()
    await act(() => vi.advanceTimersByTimeAsync(5100))
    expect(requestsTo(api.requests, "/schedule").length).toBeGreaterThan(before)
    expect(requestsTo(api.requests, "/availability").length).toBeGreaterThan(availabilityBefore)
  })

  it("leaves the lane view's panel out of the tab order, so Tab goes from the toolbar straight into the timeline", async () => {
    mockBoardApi()
    renderBoard(readingBoard)
    await lane("Bay 1 - Standard")

    // The panel holds focusable content (the timeline, its blocks); a stop on the panel itself would show no focus.
    expect(screen.getByRole("tabpanel")).toHaveAttribute("tabindex", "-1")
    expect(screen.getByRole("region", { name: "Timeline by bay" })).toHaveAttribute("tabindex", "0")
  })
})

describe("dispatch board: day summary", () => {
  it("sums up the day: appointments, bay utilisation, technicians busy now and the next free slot", async () => {
    mockBoardApi()
    renderBoard(readingBoard)

    const summary = await screen.findByRole("region", { name: "Day summary" })
    const card = (name: string) => within(summary).getByRole("group", { name })
    await waitFor(() => expect(within(card("Appointments")).getByText("6")).toBeInTheDocument())
    // 420 booked minutes of 3600 bay minutes.
    expect(within(card("Bay utilisation")).getByText("12%")).toBeInTheDocument()
    expect(within(card("Bay utilisation")).getByText("7 h booked of 60 h across 6 bays")).toBeInTheDocument()
    expect(within(card("Technicians busy now")).getByText("1 of 6")).toBeInTheDocument()
    expect(await within(card("Next free slot")).findByText("10:15")).toBeInTheDocument()
    expect(within(card("Next free slot")).getByText("4 bays and 3 technicians free")).toBeInTheDocument()
    expect(within(card("Next free slot")).getByText("Interim Service, 60 min")).toBeInTheDocument()
  })

  it("names the next start that has not passed, even before the availability is read again", async () => {
    // 08:00 and 09:15 local are behind 09:30; the next start still ahead is 09:45.
    mockBoardApi({ availability: () => availabilityAt(60, "2026-10-13T07:00:00Z", "2026-10-13T08:15:00Z", "2026-10-13T08:45:00Z") })
    renderBoard(readingBoard)

    const next = await screen.findByRole("group", { name: "Next free slot" })
    expect(await within(next).findByText("09:45")).toBeInTheDocument()
  })

  it("says so when every free start today has passed", async () => {
    mockBoardApi({ availability: () => availabilityAt(60, "2026-10-13T07:00:00Z", "2026-10-13T08:15:00Z") })
    renderBoard(readingBoard)

    const next = await screen.findByRole("group", { name: "Next free slot" })
    expect(await within(next).findByText("No free start left today")).toBeInTheDocument()
    expect(within(next).getByText("None")).toBeInTheDocument()
  })

  /** Each service's own free starts: Interim Service from 10:15 local, Full Service from 11:00. */
  const availabilityByService = (_: string, serviceTypeId: string) =>
    serviceTypeId === interimServiceType.id
      ? availabilityAt(60, "2026-10-13T09:15:00Z")
      : serviceTypeId === fullServiceType.id
        ? availabilityAt(120, "2026-10-13T10:00:00Z")
        : problemResponse(404, { type: "https://api.keyloop.example/problems/not-found", title: "Resource not found", status: 404 })

  it("looks up Interim Service's free starts wherever the catalogue lists it", async () => {
    mockBoardApi({ serviceTypes: () => [fullServiceType, interimServiceType], availability: availabilityByService })
    renderBoard(readingBoard)

    const next = await screen.findByRole("group", { name: "Next free slot" })
    expect(await within(next).findByText("10:15")).toBeInTheDocument()
    expect(within(next).getByText("Interim Service, 60 min")).toBeInTheDocument()
  })

  it("falls back to the first bookable service when the dealership cannot book Interim Service", async () => {
    mockBoardApi({
      serviceTypes: () => [{ ...interimServiceType, bookable: false }, fullServiceType],
      availability: availabilityByService,
    })
    renderBoard(readingBoard)

    const next = await screen.findByRole("group", { name: "Next free slot" })
    expect(await within(next).findByText("11:00")).toBeInTheDocument()
    expect(within(next).getByText("Full Service, 120 min")).toBeInTheDocument()
  })

  it("has no 'busy now' figure on another day, and names that day's first free slot", async () => {
    mockBoardApi()
    renderBoard(`${readingBoard}&date=2026-10-14`)

    const summary = await screen.findByRole("region", { name: "Day summary" })
    const busy = within(summary).getByRole("group", { name: "Technicians busy now" })
    await waitFor(() => expect(within(busy).getByText("Shown for today only")).toBeInTheDocument())
    expect(await within(summary).findByRole("group", { name: "First free slot" })).toBeInTheDocument()
  })
})

describe("dispatch board: details and cancellation", () => {
  async function openInterim() {
    fireEvent.click(await block(interimLabel))
    return screen.findByRole("dialog", { name: "Interim Service" })
  }

  it("opens an appointment's details from its block", async () => {
    mockBoardApi()
    renderBoard(readingBoard)

    const sheet = await openInterim()
    // The sheet is modal: the board behind it is hidden from assistive technology until it closes.
    expect(screen.getByRole("button", { name: interimLabel, hidden: true })).toHaveAttribute("aria-expanded", "true")
    expect(within(sheet).getByText("Confirmed")).toBeInTheDocument()
    expect(within(sheet).getByText("Tuesday 13 October 2026, 08:00–09:00 (Europe/London)")).toBeInTheDocument()
    expect(within(sheet).getByText("Bay 1 - Standard")).toBeInTheDocument()
    expect(within(sheet).getByText("Amelia Clarke")).toBeInTheDocument()
    expect(within(sheet).getByText("RF20 BCJ")).toBeInTheDocument()
    expect(within(sheet).getByText("JTDKN3DU0A0123460")).toBeInTheDocument()
    // The whole record comes from GET /appointments/{id}.
    expect(await within(sheet).findByRole("link", { name: "sophie.turner@example.com" })).toHaveAttribute(
      "href",
      "mailto:sophie.turner@example.com"
    )
    expect(within(sheet).getByText("Toyota Prius")).toBeInTheDocument()
    expect(within(sheet).getByText("Customer waiting in the lounge.")).toBeInTheDocument()
  })

  it("returns focus to the block that opened the sheet when it closes", async () => {
    mockBoardApi()
    renderBoard(readingBoard)
    const sheet = await openInterim()
    await waitFor(() => expect(within(sheet).getByRole("heading", { name: "Interim Service" })).toHaveFocus())

    fireEvent.keyDown(document.activeElement!, { key: "Escape" })

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Interim Service" })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole("button", { name: interimLabel })).toHaveFocus())
  })

  it("cancels an appointment with a reason, then refreshes the board and the next free slot without it", async () => {
    let cancelled = false
    const api = mockBoardApi({
      schedule: () => (cancelled ? without(readingTuesday, appointments.interim.id) : readingTuesday),
      cancel: (_, body) => {
        cancelled = true
        return { ...interimDetails, status: "Cancelled", cancellationReason: String(body.reason) }
      },
    })
    renderBoard(readingBoard)
    expect(await within(await screen.findByRole("group", { name: "Next free slot" })).findByText("10:15")).toBeInTheDocument()
    const availabilityBefore = requestsTo(api.requests, "/availability").length
    const sheet = await openInterim()

    fireEvent.change(within(sheet).getByRole("textbox", { name: "Reason" }), { target: { value: "Customer rang to rearrange" } })
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel appointment" }))

    expect(await screen.findByText("Appointment cancelled")).toBeInTheDocument()
    const [cancel] = requestsTo(api.requests, "/cancel")
    expect(new URL(cancel.url).pathname).toBe(`/api/v1/appointments/${appointments.interim.id}/cancel`)
    expect(await cancel.clone().json()).toEqual({ reason: "Customer rang to rearrange" })
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Interim Service" })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByRole("button", { name: interimLabel })).not.toBeInTheDocument())
    expect(within(await lane("Bay 1 - Standard")).getAllByRole("button")).toHaveLength(2)
    // The freed bay and technician may change the next free slot, so it is read again too.
    await waitFor(() => expect(requestsTo(api.requests, "/availability").length).toBeGreaterThan(availabilityBefore))
    // Its block has left the board, so focus returns into the board (its timeline) rather than to the page body.
    await waitFor(() => expect(screen.getByRole("region", { name: reading.name })).toContainElement(document.activeElement as HTMLElement))
  })

  it("asks for a reason before cancelling", async () => {
    const api = mockBoardApi()
    renderBoard(readingBoard)
    const sheet = await openInterim()

    fireEvent.change(within(sheet).getByRole("textbox", { name: "Reason" }), { target: { value: "   " } })
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel appointment" }))

    expect(await within(sheet).findByText("Say why the appointment is cancelled.")).toBeInTheDocument()
    expect(within(sheet).getByRole("textbox", { name: "Reason" })).toHaveAttribute("aria-invalid", "true")
    expect(requestsTo(api.requests, "/cancel")).toEqual([])
  })

  it.each([
    {
      slug: "invalid-state-transition",
      title: "Invalid state transition",
      detail: "Cannot cancel this appointment while it is Cancelled.",
      extensions: { currentStatus: "Cancelled", attempted: "cancel" },
    },
    {
      slug: "concurrency-conflict",
      title: "Concurrency conflict",
      detail: "The resource was changed by another request after it was read. Reload it and retry.",
      extensions: {},
    },
  ])("shows the API's $slug refusal with its trace id as a warning, and reads the board and the record again", async ({ slug, title, detail, extensions }) => {
    const api = mockBoardApi({
      cancel: () =>
        problemResponse(409, {
          type: `https://api.keyloop.example/problems/${slug}`,
          title,
          status: 409,
          detail,
          ...extensions,
          traceId: "00-c891f6205bdf228d5ac20dc267806559-144af9ccbd8f8f2b-01",
        }),
    })
    renderBoard(readingBoard)
    const sheet = await openInterim()
    // The whole record has arrived (its contact details show).
    await within(sheet).findByRole("link", { name: "sophie.turner@example.com" })
    const record = `/appointments/${appointments.interim.id}`
    const recordsBefore = requestsTo(api.requests, record).length
    const schedulesBefore = requestsTo(api.requests, "/schedule").length

    fireEvent.change(within(sheet).getByRole("textbox", { name: "Reason" }), { target: { value: "Duplicate booking" } })
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel appointment" }))

    const alert = await within(sheet).findByRole("alert")
    expect(within(alert).getByText(title)).toBeInTheDocument()
    expect(within(alert).getByText(detail)).toBeInTheDocument()
    expect(within(alert).getByText("00-c891f6205bdf228d5ac20dc267806559-144af9ccbd8f8f2b-01")).toBeInTheDocument()
    // A refusal that reflects the current state, not a failure: read again rather than retried.
    expect(alert).toHaveAttribute("data-tone", "warning")
    // The board and the record are read again: someone else changed this appointment.
    await waitFor(() => expect(requestsTo(api.requests, "/schedule").length).toBeGreaterThan(schedulesBefore))
    await waitFor(() => expect(requestsTo(api.requests, record).length).toBeGreaterThan(recordsBefore))
    expect(screen.getByRole("dialog", { name: "Interim Service" })).toBeInTheDocument()
  })

  it("shows a failed cancellation as an error", async () => {
    mockBoardApi({ cancel: () => new Response("", { status: 502, statusText: "Bad Gateway" }) })
    renderBoard(readingBoard)
    const sheet = await openInterim()

    fireEvent.change(within(sheet).getByRole("textbox", { name: "Reason" }), { target: { value: "Duplicate booking" } })
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel appointment" }))

    const alert = await within(sheet).findByRole("alert")
    expect(within(alert).getByText("Couldn’t cancel the appointment")).toBeInTheDocument()
    expect(alert).toHaveAttribute("data-tone", "error")
  })

  it("puts the API's validation message under the reason", async () => {
    mockBoardApi({
      cancel: () =>
        problemResponse(400, {
          type: "https://api.keyloop.example/problems/validation-error",
          title: "Validation failed",
          status: 400,
          detail: "One or more fields are invalid.",
          errors: { reason: ["reason is required, 1 to 500 characters after trimming."] },
          traceId: "00-51dac6b6db268c84ee88580d5ae76293-5c2212e80cb501f8-01",
        }),
    })
    renderBoard(readingBoard)
    const sheet = await openInterim()

    fireEvent.change(within(sheet).getByRole("textbox", { name: "Reason" }), { target: { value: "x" } })
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel appointment" }))

    expect(await within(sheet).findByText("reason is required, 1 to 500 characters after trimming.")).toBeInTheDocument()
    expect(within(sheet).getByRole("textbox", { name: "Reason" })).toHaveAttribute("aria-invalid", "true")
  })

  it("offers no cancellation once work has started", async () => {
    mockBoardApi({ schedule: () => withStatus(readingTuesday, appointments.evBattery.id, "InProgress") })
    renderBoard(readingBoard)

    fireEvent.click(await block("EV Battery Health Check, Bay 4 - EV, 09:00 to 10:00, Ben Okafor, In progress"))
    const sheet = await screen.findByRole("dialog", { name: "EV Battery Health Check" })

    expect(within(sheet).getByText("Only a confirmed or checked-in appointment can be cancelled.")).toBeInTheDocument()
    expect(within(sheet).queryByRole("button", { name: "Cancel appointment" })).not.toBeInTheDocument()
  })

  it("names the bay on each block in the technician view, and the technician in the bay view", async () => {
    mockBoardApi()
    renderBoard(`${readingBoard}&lanes=technicians`)

    expect(within(await lane("Ben Okafor")).getByRole("button")).toHaveTextContent("Bay 4 - EV")
    fireEvent.click(screen.getByRole("tab", { name: "Bays" }))
    expect(within(await lane("Bay 4 - EV")).getByRole("button")).toHaveTextContent("Ben")
  })
})

describe("dispatch board: loading and failures", () => {
  it("shows a loading board until the schedule arrives", async () => {
    let answer: () => void = () => {}
    const held = new Promise<void>((resolve) => (answer = resolve))
    mockBoardApi({ schedule: async () => (await held, readingTuesday) })
    renderBoard(readingBoard)

    expect(await screen.findByText("Loading the schedule…")).toBeInTheDocument()
    answer()
    expect(await lane("Bay 1 - Standard")).toBeInTheDocument()
    expect(screen.queryByText("Loading the schedule…")).not.toBeInTheDocument()
  })

  it("shows the API's explanation and trace id when the schedule fails, and loads it on retry", async () => {
    let failing = true
    mockBoardApi({
      schedule: () =>
        failing
          ? problemResponse(429, {
              type: "https://api.keyloop.example/problems/rate-limited",
              title: "Too many requests",
              status: 429,
              detail: "Too many requests from this client. Retry after 3 seconds.",
              traceId: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
              retryAfterSeconds: 3,
            })
          : readingTuesday,
    })
    renderBoard(readingBoard)

    const alert = await screen.findByRole("alert")
    expect(within(alert).getByRole("heading", { level: 3, name: "Couldn’t load the schedule" })).toBeInTheDocument()
    expect(within(alert).getByText("Too many requests from this client. Retry after 3 seconds.")).toBeInTheDocument()
    expect(alert.querySelector('img[src*="error-connection"]')).toHaveAttribute("alt", "")
    expect(within(alert).getByText("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")).toBeInTheDocument()

    failing = false
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }))

    expect(await lane("Bay 1 - Standard")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("keeps the board when a background refresh fails", async () => {
    let failing = false
    const api = mockBoardApi({
      schedule: () => (failing ? new Response("", { status: 502, statusText: "Bad Gateway" }) : readingTuesday),
    })
    const { queryClient } = renderBoard(readingBoard)
    await lane("Bay 1 - Standard")

    failing = true
    const before = requestsTo(api.requests, "/schedule").length
    await act(() => queryClient.refetchQueries())
    await waitFor(() => expect(requestsTo(api.requests, "/schedule").length).toBeGreaterThan(before))

    expect(await lane("Bay 1 - Standard")).toBeInTheDocument()
    expect(screen.queryByText("Couldn’t load the schedule")).not.toBeInTheDocument()
  })

  it("switches the board to another dealership's lanes", async () => {
    mockBoardApi()
    renderBoard(readingBoard)
    await lane("Bay 1 - Standard")

    fireEvent.click(await screen.findByRole("combobox", { name: "Dealership" }))
    pointerClick(await screen.findByRole("option", { name: /München/ }))

    expect(await boardHeading(munich.name)).toBeInTheDocument()
    expect(await lane("Halle 1")).toBeInTheDocument()
  })
})
