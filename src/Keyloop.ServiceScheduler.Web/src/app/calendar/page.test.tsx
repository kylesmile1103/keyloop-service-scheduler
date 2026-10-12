import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { AppointmentListItemResponse, CurrentUserResponse } from "@/api/types.gen"
import { NO_ROLE_REASON, READ_ONLY_REASON } from "@/lib/session"
import { mockBoardApi, rangeFromSchedules, requestsTo } from "@/test/board-api"
import { munich, reading } from "@/test/dealerships"
import { expectAvailable, expectUnavailableButFocusable } from "@/test/focus"
import { deferred } from "@/test/identity-change"
import { anonymous, noRole, viewer } from "@/test/identities"
import { problemResponse } from "@/test/mock-api"
import { phoneViewport, pointerClick, renderBoard, search } from "@/test/render-board"
import { appointments } from "@/test/schedules"

// The Calendar (Task 28b): one dealership's appointments by week or month from one range read, on the dealership's own
// calendar, with the board's details sheet and booking dialog.

beforeAll(async () => {
  await Promise.all([import("@/app/calendar/page"), import("@/app/dispatch/page")])
})

beforeEach(() => {
  // Tuesday 2026-10-13, 09:30 in Reading (BST). Only Date is faked; timers stay real for the UI.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

const calendar = `/calendar?dealership=${reading.id}`
const title = (name: string) => screen.findByRole("heading", { level: 2, name })
/** A day's column, cell or agenda section, found by its heading ("Tuesday 13 October, today, dispatch board"). */
const day = async (name: string) => (await screen.findByRole("heading", { level: 3, name })).closest("li")!
const rangeReads = (requests: readonly Request[]) => requestsTo(requests, "/appointments").filter((request) => request.method === "GET")
/** The distinct ranges read (StrictMode mounts a page twice in development, so a read can be sent twice). */
const rangesRead = (requests: readonly Request[]) => [...new Set(rangeReads(requests).map((request) => new URL(request.url).search))]
const writes = (requests: readonly Request[]) => requests.filter((request) => request.method !== "GET")
const interimLabel = "Interim Service, Bay 1 - Standard, 08:00 to 09:00, Sophie Turner, Amelia Clarke, Confirmed"

describe("the range read", () => {
  it("reads Monday to Sunday of the week holding today, with every status", async () => {
    const { requests } = mockBoardApi()
    renderBoard(calendar)

    expect(await title("12–18 October 2026")).toBeInTheDocument()
    await waitFor(() => expect(rangesRead(requests)).toEqual(["?from=2026-10-12&to=2026-10-18"]))
  })

  it("reads a month's whole weeks in the month view", async () => {
    const { requests } = mockBoardApi()
    renderBoard(`${calendar}&view=month`)

    expect(await title("October 2026")).toBeInTheDocument()
    await waitFor(() => expect(rangesRead(requests)).toEqual(["?from=2026-09-28&to=2026-11-01"]))
  })

  it("counts weeks on the dealership's calendar, not the browser's", async () => {
    // 22:30 UTC on Sunday 18 October is already Monday 19 in München.
    vi.setSystemTime(new Date("2026-10-18T22:30:00Z"))
    const { requests } = mockBoardApi()
    renderBoard(`/calendar?dealership=${munich.id}`)

    expect(await title("19–25 October 2026")).toBeInTheDocument()
    await waitFor(() => expect(rangesRead(requests)).toEqual(["?from=2026-10-19&to=2026-10-25"]))
  })
})

describe("moving through weeks and months", () => {
  it("steps a week at a time, back to today, and switches to the month, keeping the dealership in the address", async () => {
    const { requests } = mockBoardApi()
    const { router } = renderBoard(calendar)
    await title("12–18 October 2026")
    const today = screen.getByRole("button", { name: "Today" })
    expectUnavailableButFocusable(today)

    fireEvent.click(screen.getByRole("button", { name: "Next week" }))
    expect(await title("19–25 October 2026")).toBeInTheDocument()
    expect(search(router)).toEqual({ dealership: reading.id, date: "2026-10-20" })
    expectAvailable(today)

    fireEvent.click(today)
    expect(await title("12–18 October 2026")).toBeInTheDocument()
    expect(search(router)).toEqual({ dealership: reading.id })

    fireEvent.click(screen.getByRole("tab", { name: "Month" }))
    expect(await title("October 2026")).toBeInTheDocument()
    expect(search(router)).toEqual({ dealership: reading.id, view: "month" })
    fireEvent.click(screen.getByRole("button", { name: "Next month" }))
    expect(await title("November 2026")).toBeInTheDocument()
    await waitFor(() => expect(rangesRead(requests)).toContain("?from=2026-10-26&to=2026-12-06"))
  })

  it("opens on the week of the day the board was showing", async () => {
    mockBoardApi()
    renderBoard(`${calendar}&date=2026-10-29`)

    expect(await title("26 October – 1 November 2026")).toBeInTheDocument()
  })
})

describe("the week", () => {
  it("lists each day's appointments in start order, hatches closed days and leaves cancelled appointments out", async () => {
    mockBoardApi({
      range: (id, from, to) => rangeFromSchedules(id, from, to).map((item) => (item.id === appointments.mot.id ? { ...item, status: "Cancelled" as const } : item)),
    })
    renderBoard(calendar)

    const tuesday = await day("Tuesday 13 October, today, dispatch board")
    expect(within(tuesday).getAllByRole("button", { name: /, Confirmed$/ }).map((chip) => chip.getAttribute("aria-label")!.split(",")[0])).toEqual([
      "Interim Service",
      "EV Battery Health Check",
      "Brake Pads & Discs",
      "Full Service",
      "Four-Wheel Alignment",
    ])
    // The status in words and the count of what is shown.
    expect(tuesday).toHaveTextContent("5 appointments")
    const sunday = await day("Sunday 18 October, dispatch board")
    expect(within(sunday).getByText("Closed")).toBeInTheDocument()
    expect(within(sunday).queryAllByRole("button")).toHaveLength(0)
    expect(screen.getByText("Times in Europe/London. Cancelled appointments are not shown.")).toBeInTheDocument()
  })

  it("links each day's heading to its dispatch board", async () => {
    mockBoardApi()
    renderBoard(calendar)

    expect(await screen.findByRole("link", { name: "Wednesday 14 October, dispatch board" })).toHaveAttribute(
      "href",
      `/dispatch?dealership=${reading.id}&date=2026-10-14`
    )
    expect(screen.getByRole("link", { name: "Tuesday 13 October, today, dispatch board" })).toHaveAttribute("href", `/dispatch?dealership=${reading.id}`)
  })

  it("opens an appointment in the board's details sheet and gives focus back to it", async () => {
    mockBoardApi()
    renderBoard(calendar)

    const chip = within(await day("Tuesday 13 October, today, dispatch board")).getByRole("button", { name: interimLabel })
    chip.focus()
    fireEvent.click(chip)
    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    expect(await within(sheet).findByText("sophie.turner@example.com")).toBeInTheDocument()

    fireEvent.keyDown(sheet, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    await waitFor(() => expect(chip).toHaveFocus())
  })

  it("offers New appointment on today and later open days only, opening the booking dialog on that day", async () => {
    mockBoardApi()
    renderBoard(calendar)
    await day("Tuesday 13 October, today, dispatch board")

    expect(screen.queryByRole("button", { name: "New appointment on Monday 12 October" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "New appointment on Sunday 18 October" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "New appointment on Tuesday 13 October" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "New appointment on Thursday 15 October" }))
    const dialog = await screen.findByRole("dialog", { name: "Book appointment" })
    expect(within(dialog).getByRole("button", { name: "Date, Thursday 15 October 2026" })).toBeInTheDocument()
  })

  it("starts the toolbar's New appointment on the day the calendar is anchored on, or today for a past one", async () => {
    mockBoardApi()
    const { router } = renderBoard(`${calendar}&date=2026-10-22`)

    fireEvent.click(await screen.findByRole("button", { name: "New appointment" }))
    let dialog = await screen.findByRole("dialog", { name: "Book appointment" })
    expect(within(dialog).getByRole("button", { name: "Date, Thursday 22 October 2026" })).toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    await router.navigate(`${calendar}&date=2026-10-06`)
    await title("5–11 October 2026")
    fireEvent.click(screen.getByRole("button", { name: "New appointment" }))
    dialog = await screen.findByRole("dialog", { name: "Book appointment" })
    expect(within(dialog).getByRole("button", { name: "Date, Tuesday 13 October 2026" })).toBeInTheDocument()
  })
})

describe("the month", () => {
  it("shows three appointments a day, or two and how many more, which opens that day's week", async () => {
    mockBoardApi()
    const { router } = renderBoard(`${calendar}&view=month`)

    // Every open day of the fixtures holds six appointments: two shown, four more.
    const wednesday = await day("Wednesday 14 October, dispatch board")
    expect(within(wednesday).getAllByRole("button", { name: /, Confirmed$/ })).toHaveLength(2)
    // The days of the months either side are in the grid too, with their appointments.
    expect(await day("Monday 28 September, dispatch board")).toBeInTheDocument()

    fireEvent.click(within(wednesday).getByRole("button", { name: "4 more on Wednesday 14 October: show the week" }))
    expect(await title("12–18 October 2026")).toBeInTheDocument()
    expect(search(router)).toEqual({ dealership: reading.id, date: "2026-10-14" })
  })

  it("shows all of three appointments without a count", async () => {
    mockBoardApi({ range: (id, from, to) => rangeFromSchedules(id, from, to).filter((item) => !item.startLocal.startsWith("2026-10-14") || item.startLocal < "2026-10-14T11") })
    renderBoard(`${calendar}&view=month`)

    const wednesday = await day("Wednesday 14 October, dispatch board")
    expect(within(wednesday).getAllByRole("button", { name: /, Confirmed$/ })).toHaveLength(3)
    expect(within(wednesday).queryByRole("button", { name: /more on/ })).not.toBeInTheDocument()
  })
})

describe("+N more and focus", () => {
  const wednesdayHeading = () => screen.findByRole("heading", { level: 3, name: "Wednesday 14 October, dispatch board" })
  const more = "4 more on Wednesday 14 October: show the week"

  it.each(["the keyboard", "a mouse"])("moves focus from +N more, used with %s, to that day's heading once its week has loaded", async (how) => {
    const week = deferred<AppointmentListItemResponse[]>()
    mockBoardApi({ range: (id, from, to) => (from === "2026-10-12" ? week.promise : rangeFromSchedules(id, from, to)) })
    renderBoard(`${calendar}&view=month`)
    const button = within(await day("Wednesday 14 October, dispatch board")).getByRole("button", { name: more })

    if (how === "the keyboard") {
      // Enter on a focused button is its click.
      button.focus()
      fireEvent.keyDown(button, { key: "Enter" })
      fireEvent.click(button)
    } else pointerClick(button)

    expect(await title("12–18 October 2026")).toBeInTheDocument()
    // The month, and the button with it, are gone; the week is still loading.
    expect(button).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument()

    week.release(rangeFromSchedules(reading.id, "2026-10-12", "2026-10-18"))

    const heading = await wednesdayHeading()
    await waitFor(() => expect(heading).toHaveFocus())
    // The day's own controls and appointments follow it in the tab order.
    const column = heading.closest("li")!
    expect(heading.compareDocumentPosition(within(column).getAllByRole("button", { name: /, Confirmed$/ })[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("moves focus at once when the week is already read", async () => {
    mockBoardApi()
    const { router } = renderBoard(`${calendar}&date=2026-10-14`)
    expect(await wednesdayHeading()).toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: "Month" }))
    const button = within(await day("Wednesday 14 October, dispatch board")).getByRole("button", { name: more })

    button.focus()
    fireEvent.click(button)

    await waitFor(async () => expect(await wednesdayHeading()).toHaveFocus())
    expect(search(router)).toEqual({ dealership: reading.id, date: "2026-10-14" })
  })

  it("leaves focus alone when the week is left before it has loaded", async () => {
    const week = deferred<AppointmentListItemResponse[]>()
    mockBoardApi({ range: (id, from, to) => (from === "2026-10-12" ? week.promise : rangeFromSchedules(id, from, to)) })
    renderBoard(`${calendar}&view=month`)
    fireEvent.click(within(await day("Wednesday 14 October, dispatch board")).getByRole("button", { name: more }))
    expect(await title("12–18 October 2026")).toBeInTheDocument()

    const next = screen.getByRole("button", { name: "Next week" })
    next.focus()
    fireEvent.click(next)
    expect(await title("19–25 October 2026")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }))
    expect(await title("12–18 October 2026")).toBeInTheDocument()
    screen.getByRole("button", { name: "Previous week" }).focus()
    week.release(rangeFromSchedules(reading.id, "2026-10-12", "2026-10-18"))

    expect(await wednesdayHeading()).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByRole("button", { name: "Previous week" })).toHaveFocus()
  })
})

describe("a month day with four appointments", () => {
  it("shows two and says two more, never hiding one unsaid", async () => {
    mockBoardApi({ range: (id, from, to) => rangeFromSchedules(id, from, to).filter((item) => !item.startLocal.startsWith("2026-10-14") || item.startLocal < "2026-10-14T12") })
    renderBoard(`${calendar}&view=month`)

    const wednesday = await day("Wednesday 14 October, dispatch board")
    expect(within(wednesday).getAllByRole("button", { name: /, Confirmed$/ })).toHaveLength(2)
    expect(within(wednesday).getByRole("button", { name: "2 more on Wednesday 14 October: show the week" })).toHaveTextContent("+2 more")
  })
})

describe("roles", () => {
  it("asks a visitor who is not signed in to sign in from New appointment and from a day, and sends nothing", async () => {
    const { requests } = mockBoardApi({ me: () => anonymous })
    renderBoard(calendar)

    fireEvent.click(await screen.findByRole("button", { name: "New appointment" }))
    expect(await screen.findByRole("dialog", { name: "Sign in to book" })).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole("dialog", { name: "Sign in to book" })).getByRole("button", { name: "Not now" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: "New appointment on Wednesday 14 October" }))
    expect(await screen.findByRole("dialog", { name: "Sign in to book" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Book appointment" })).not.toBeInTheDocument()
    expect(writes(requests)).toHaveLength(0)
  })

  it.each<[string, CurrentUserResponse, string]>([
    ["a Viewer", viewer, READ_ONLY_REASON],
    ["an account without a role", noRole, NO_ROLE_REASON],
  ])("shows %s every New appointment unavailable, with the reason on screen and read with it", async (_, me, reason) => {
    const { requests } = mockBoardApi({ me: () => me })
    renderBoard(calendar)

    const toolbar = await screen.findByRole("button", { name: "New appointment" })
    const onDay = screen.getByRole("button", { name: "New appointment on Wednesday 14 October" })
    for (const button of [toolbar, onDay]) {
      expectUnavailableButFocusable(button)
      expect(document.getElementById(button.getAttribute("aria-describedby")!)).toHaveTextContent(reason)
      fireEvent.click(button)
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(writes(requests)).toHaveLength(0)
  })

  it("shows a visitor the names masked as the API sends them", async () => {
    const masked = (item: AppointmentListItemResponse) => ({ ...item, customerName: item.customerName.split(" ").map((part) => part[0]).join(""), registration: "*******" })
    mockBoardApi({ me: () => anonymous, range: (id, from, to) => rangeFromSchedules(id, from, to).map(masked) })
    renderBoard(calendar)

    const tuesday = await day("Tuesday 13 October, today, dispatch board")
    expect(within(tuesday).getByRole("button", { name: "Interim Service, Bay 1 - Standard, 08:00 to 09:00, ST, Amelia Clarke, Confirmed" })).toBeInTheDocument()
  })
})

describe("an empty range", () => {
  it("shows the empty-calendar picture with its alt text and New appointment on the first day that can take one", async () => {
    mockBoardApi({ range: () => [] })
    renderBoard(calendar)

    expect(await screen.findByRole("heading", { level: 3, name: "Nothing booked this week" })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "Week-view calendar with open slots and a small generic car icon." })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole("button", { name: "New appointment" })[1])
    const dialog = await screen.findByRole("dialog", { name: "Book appointment" })
    expect(within(dialog).getByRole("button", { name: "Date, Tuesday 13 October 2026" })).toBeInTheDocument()
  })

  it("says nothing was booked in a past week, with no action", async () => {
    mockBoardApi({ range: () => [] })
    renderBoard(`${calendar}&date=2026-10-06`)

    expect(await screen.findByRole("heading", { level: 3, name: "Nothing booked from Monday 5 October to Sunday 11 October" })).toBeInTheDocument()
    expect(screen.getByText("Nothing was booked in those days.")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "New appointment" })).toHaveLength(1)
  })
})

describe("on a phone", () => {
  it("lists the week as an agenda of job cards by day, with New as a floating action", async () => {
    phoneViewport()
    mockBoardApi()
    renderBoard(calendar)

    const tuesday = await day("Tuesday 13 October, today, dispatch board")
    expect(within(tuesday).getByRole("button", { name: interimLabel })).toBeInTheDocument()
    expect(within(await day("Sunday 18 October, dispatch board")).getByText("Closed")).toBeInTheDocument()

    const fab = screen.getAllByRole("button", { name: "New appointment" }).find((button) => button.dataset.slot === "new-fab")!
    fireEvent.click(fab)
    expect(await screen.findByRole("dialog", { name: "Book appointment" })).toBeInTheDocument()
  })

  it("lists only the month's own days in the month view", async () => {
    phoneViewport()
    mockBoardApi()
    renderBoard(`${calendar}&view=month`)

    expect(await day("Thursday 1 October, dispatch board")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { level: 3, name: "Monday 28 September, dispatch board" })).not.toBeInTheDocument()
  })
})

describe("a failed read", () => {
  it("says the appointments could not be loaded and recovers with Try again", async () => {
    let fail = true
    mockBoardApi({
      range: (id, from, to) =>
        fail
          ? problemResponse(500, {
              type: "https://api.keyloop.example/problems/internal-error",
              title: "An unexpected error occurred",
              status: 500,
              traceId: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            })
          : rangeFromSchedules(id, from, to),
    })
    renderBoard(calendar)

    const alert = await screen.findByRole("alert")
    expect(within(alert).getByRole("heading", { name: "Couldn’t load the appointments" })).toBeInTheDocument()
    fail = false
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }))
    expect(await day("Tuesday 13 October, today, dispatch board")).toBeInTheDocument()
  })
})

describe("navigation", () => {
  it("lists the Calendar after the board, carrying the dealership and the board's day to its week", async () => {
    mockBoardApi()
    const { router } = renderBoard(`/dispatch?dealership=${reading.id}&date=2026-10-20`)
    await screen.findByRole("heading", { level: 1, name: "Dispatch board" })

    const workshop = screen.getByRole("navigation", { name: "Workshop" })
    expect(within(workshop).getAllByRole("link").map((link) => link.textContent)).toEqual(["Overview", "Dispatch board", "Calendar", "Appointments"])
    const link = within(workshop).getByRole("link", { name: "Calendar" })
    expect(link).toHaveAttribute("href", `/calendar?dealership=${reading.id}&date=2026-10-20`)

    fireEvent.click(link)
    expect(await title("19–25 October 2026")).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/calendar")
  })
})
