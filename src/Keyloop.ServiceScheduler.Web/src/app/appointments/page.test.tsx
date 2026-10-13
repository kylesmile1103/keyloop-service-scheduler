import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { ScheduledAppointmentResponse, WorkshopScheduleResponse } from "@/api/types.gen"
import { mockBoardApi, requestsTo } from "@/test/board-api"
import { munich, reading } from "@/test/dealerships"
import { problemResponse } from "@/test/mock-api"
import { renderBoard, search, viewportOf } from "@/test/render-board"
import { appointments, bays, interimDetails, readingTuesday, without, withStatus } from "@/test/schedules"

// The Appointments page (Task 17c): the board's day as a sortable, filterable list, with the board's details sheet.

beforeAll(async () => {
  await import("@/app/appointments/page")
})

beforeEach(() => {
  // Tuesday 2026-10-13, 09:30 in Reading (BST). Only Date is faked; timers stay real for the UI.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

const readingList = `/appointments?dealership=${reading.id}`
const table = () => screen.findByRole("table", { name: "Appointments" })
/** The body rows (the header row is in the first row group). */
const bodyRows = (list: HTMLElement) => within(within(list).getAllByRole("rowgroup")[1]).getAllByRole("row")
/** What a column shows in each body row, by its header's name. */
function columnTexts(list: HTMLElement, header: string): string[] {
  const headers = within(list).getAllByRole("columnheader")
  const index = headers.findIndex((cell) => cell.textContent?.trim() === header)
  if (index === -1) throw new Error(`no column "${header}"`)
  return bodyRows(list).map((row) => within(row).getAllByRole("cell")[index].textContent?.trim() ?? "")
}
const actionsFor = (label: string) => screen.findByRole("button", { name: `Actions for ${label}` })
const openFilter = async (name: string) => {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${name} filter(,|$)`) }))
  return screen.findByRole("dialog", { name })
}

/** Reading's Tuesday with six more appointments in Bays 3 and 5, so the day has twelve. */
function longDay(): WorkshopScheduleResponse {
  const extra = (index: number): ScheduledAppointmentResponse => {
    const start = Date.parse("2026-10-13T07:00:00Z") + index * 3_600_000
    const at = (instant: number) => new Date(instant).toISOString().replace(".000Z", "Z")
    const local = (instant: number) => `${new Date(instant + 3_600_000).toISOString().slice(0, 16)}+01:00`
    return {
      ...appointments.interim,
      id: `0000000${index}-aaaa-4bbb-8ccc-000000000000`,
      startUtc: at(start),
      endUtc: at(start + 3_600_000),
      startLocal: local(start),
      endLocal: local(start + 3_600_000),
      customerName: `Extra Customer ${index}`,
      vin: `EXTRAVIN000000${String(index).padStart(3, "0")}`,
      registration: `EX0${index} AAA`,
    }
  }
  return {
    ...readingTuesday,
    bays: readingTuesday.bays.map((bay) =>
      bay.id === bays.heavy.id ? { ...bay, appointments: [0, 1, 2, 3, 4, 5].map(extra) } : bay
    ),
  }
}

describe("appointments list", () => {
  it("lists the board's day as a table by start time, with every column on a wide screen", async () => {
    viewportOf(1600)
    mockBoardApi()
    renderBoard(readingList)

    const list = await table()
    expect(within(list).getAllByRole("columnheader").map((cell) => cell.textContent?.trim())).toEqual([
      "Time",
      "Status",
      "Service",
      "Bay",
      "Technician",
      "Customer",
      "Registration",
      "VIN",
      "Duration",
      "Actions",
    ])
    expect(columnTexts(list, "Time")).toEqual(["08:00–09:00", "09:00–10:00", "10:30–12:00", "11:00–11:45", "13:00–15:00", "15:00–15:45"])
    const [first] = bodyRows(list)
    const cells = within(first).getAllByRole("cell").map((cell) => cell.textContent?.trim())
    expect(cells.slice(0, 9)).toEqual([
      "08:00–09:00",
      "Confirmed",
      "Interim Service",
      "Bay 1 - Standard",
      "ACAmelia Clarke",
      "Sophie Turner",
      "RF20 BCJ",
      "JTDKN3DU0A0123460",
      "60 min",
    ])
    expect(columnTexts(list, "Duration")).toEqual(["60 min", "60 min", "90 min", "45 min", "120 min", "45 min"])
    // Six appointments fit one page, so there are no page controls to frame them.
    expect(screen.getByRole("status")).toHaveTextContent("6 appointments")
    expect(screen.queryByRole("navigation", { name: "Pages" })).not.toBeInTheDocument()
    // Times are the dealership's own, and the page says which zone they are in.
    expect(screen.getByText("Open today 08:00–18:00 (Europe/London).")).toBeInTheDocument()
    expect(document.title).toBe("Appointments – Keyloop Service Scheduler")
  })

  it("leaves Duration out below 1536 px and VIN too below 1440 px, and View brings them back", async () => {
    const headers = (list: HTMLElement) => within(list).getAllByRole("columnheader").map((cell) => cell.textContent?.trim())
    mockBoardApi()
    renderBoard(readingList)

    // 1440 px (the test default): the time range already says how long each appointment is.
    const list = await table()
    expect(headers(list)).not.toContain("Duration")
    expect(headers(list)).toContain("VIN")

    fireEvent.click(screen.getByRole("button", { name: "View" }))
    const menu = await screen.findByRole("menu")
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Duration" })).toHaveAttribute("aria-checked", "false")
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Duration" }))
    await waitFor(() => expect(headers(list)).toContain("Duration"))
  })

  it.each([1024, 1280])("leaves VIN and Duration out on a %i px screen", async (width) => {
    viewportOf(width)
    mockBoardApi()
    renderBoard(readingList)

    const list = await table()
    const headers = within(list).getAllByRole("columnheader").map((cell) => cell.textContent?.trim())
    expect(headers).toEqual(["Time", "Status", "Service", "Bay", "Technician", "Customer", "Registration", "Actions"])
  })

  it("shows the day's figures above the list, whatever the filters", async () => {
    // Every figure differs (6, 3, 2, 1), so each is pinned to its own statuses.
    let schedule = withStatus(readingTuesday, appointments.interim.id, "Completed")
    schedule = withStatus(schedule, appointments.full.id, "Completed")
    schedule = withStatus(schedule, appointments.evBattery.id, "NoShow")
    schedule = withStatus(schedule, appointments.brakes.id, "InProgress")
    mockBoardApi({ schedule: () => schedule })
    renderBoard(readingList)

    const summary = await screen.findByRole("region", { name: "Day summary" })
    /** A card's figure (its large number, exactly) and its share of the day. */
    const expectFigure = (name: string, value: string, share: string) => {
      const card = within(summary).getByRole("group", { name })
      expect(within(card).getByText(value, { exact: true })).toBeInTheDocument()
      expect(card).toHaveTextContent(share)
    }
    const expectTheDay = () => {
      expectFigure("Appointments", "6", "2 confirmed, 1 in progress, 2 completed, 1 no-show")
      expectFigure("Active", "3", "3 of 6 appointments")
      expectFigure("Completed", "2", "2 of 6 appointments")
      expectFigure("No-shows", "1", "1 of 6 appointments")
    }
    await waitFor(() => expect(within(summary).getByRole("group", { name: "Appointments" })).not.toHaveAttribute("aria-busy"))
    expectTheDay()

    // The figures are the whole day's: narrowing the list leaves them alone.
    const list = await table()
    const statusFilter = await openFilter("Status")
    fireEvent.click(within(statusFilter).getByRole("checkbox", { name: /^Completed/ }))
    fireEvent.keyDown(statusFilter, { key: "Escape" })
    fireEvent.change(screen.getByRole("searchbox", { name: "Search appointments" }), { target: { value: "olivia" } })
    expect(columnTexts(list, "Customer")).toEqual(["Olivia Bennett"])
    expectTheDay()
  })

  it("sorts by a column's header, and again the other way", async () => {
    mockBoardApi()
    renderBoard(readingList)
    const list = await table()
    expect(within(list).getByRole("columnheader", { name: "Time" })).toHaveAttribute("aria-sort", "ascending")

    fireEvent.click(within(list).getByRole("button", { name: "Customer" }))

    expect(columnTexts(list, "Customer")).toEqual([
      "Emily Clarkson",
      "Harry Whitfield",
      "Jack Davies",
      "Mohammed Rahman",
      "Olivia Bennett",
      "Sophie Turner",
    ])
    expect(within(list).getByRole("columnheader", { name: "Customer" })).toHaveAttribute("aria-sort", "ascending")
    expect(within(list).getByRole("columnheader", { name: "Time" })).not.toHaveAttribute("aria-sort")

    fireEvent.click(within(list).getByRole("button", { name: "Customer" }))

    expect(columnTexts(list, "Customer")[0]).toBe("Sophie Turner")
    expect(within(list).getByRole("columnheader", { name: "Customer" })).toHaveAttribute("aria-sort", "descending")
  })

  it("sorts statuses in their lifecycle order, not alphabetically", async () => {
    let schedule = withStatus(readingTuesday, appointments.interim.id, "NoShow")
    schedule = withStatus(schedule, appointments.evBattery.id, "Completed")
    schedule = withStatus(schedule, appointments.brakes.id, "CheckedIn")
    mockBoardApi({ schedule: () => schedule })
    renderBoard(readingList)
    const list = await table()

    fireEvent.click(within(list).getByRole("button", { name: "Status" }))

    expect(columnTexts(list, "Status")).toEqual(["Confirmed", "Confirmed", "Confirmed", "Checked in", "Completed", "No-show"])
  })

  it("searches by customer, registration or VIN", async () => {
    mockBoardApi()
    renderBoard(readingList)
    const list = await table()
    const searchBox = screen.getByRole("searchbox", { name: "Search appointments" })

    fireEvent.change(searchBox, { target: { value: "re21klm" } })
    expect(columnTexts(list, "Customer")).toEqual(["Olivia Bennett"])

    fireEvent.change(searchBox, { target: { value: "wf0xxx" } })
    expect(columnTexts(list, "Customer")).toEqual(["Mohammed Rahman"])

    fireEvent.change(searchBox, { target: { value: "clark" } })
    expect(columnTexts(list, "Customer")).toEqual(["Emily Clarkson"])
    expect(screen.getByRole("status")).toHaveTextContent("1 of 6 appointments")
  })

  it("filters by status, bay, technician and service, with how many each choice holds", async () => {
    mockBoardApi({ schedule: () => withStatus(readingTuesday, appointments.mot.id, "Completed") })
    renderBoard(readingList)
    const list = await table()

    const bayFilter = await openFilter("Bay")
    expect(within(bayFilter).getByRole("checkbox", { name: "Bay 1 - Standard (3 appointments)" })).not.toBeChecked()
    expect(within(bayFilter).getByRole("checkbox", { name: "Bay 2 - Alignment (1 appointment)" })).toBeInTheDocument()
    expect(within(bayFilter).getByRole("checkbox", { name: "Bay 3 - Heavy duty (0 appointments)" })).toBeInTheDocument()
    fireEvent.click(within(bayFilter).getByRole("checkbox", { name: /^Bay 1 - Standard/ }))
    fireEvent.click(within(bayFilter).getByRole("checkbox", { name: /^Bay 6 - MOT/ }))
    fireEvent.keyDown(bayFilter, { key: "Escape" })

    expect(columnTexts(list, "Bay")).toEqual(["Bay 1 - Standard", "Bay 1 - Standard", "Bay 6 - MOT", "Bay 1 - Standard"])
    expect(screen.getByRole("button", { name: "Bay filter, 2 selected" })).toBeInTheDocument()

    // The other filters count what the bay filter leaves.
    const statusFilter = await openFilter("Status")
    expect(within(statusFilter).getByRole("checkbox", { name: "Confirmed (3 appointments)" })).toBeInTheDocument()
    fireEvent.click(within(statusFilter).getByRole("checkbox", { name: /^Completed/ }))
    fireEvent.keyDown(statusFilter, { key: "Escape" })
    expect(columnTexts(list, "Service")).toEqual(["MOT Test"])

    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }))

    expect(bodyRows(list)).toHaveLength(6)
    expect(screen.getByRole("button", { name: "Bay filter" })).toBeInTheDocument()
  })

  it("filters by technician and by service, and clears one filter from its own popover", async () => {
    mockBoardApi()
    renderBoard(readingList)
    const list = await table()

    const technicianFilter = await openFilter("Technician")
    fireEvent.click(within(technicianFilter).getByRole("checkbox", { name: "Chloe Nguyen (2 appointments)" }))
    fireEvent.keyDown(technicianFilter, { key: "Escape" })
    expect(columnTexts(list, "Customer")).toEqual(["Emily Clarkson", "Harry Whitfield"])

    const serviceFilter = await openFilter("Service")
    fireEvent.click(within(serviceFilter).getByRole("checkbox", { name: /^Four-Wheel Alignment/ }))
    fireEvent.keyDown(serviceFilter, { key: "Escape" })
    expect(columnTexts(list, "Customer")).toEqual(["Harry Whitfield"])

    // Clear filter empties that filter only: the technician filter still holds.
    const again = await openFilter("Service")
    fireEvent.click(within(again).getByRole("button", { name: "Clear filter" }))
    expect(within(again).getByRole("checkbox", { name: /^Four-Wheel Alignment/ })).not.toBeChecked()
    expect(columnTexts(list, "Customer")).toEqual(["Emily Clarkson", "Harry Whitfield"])
    fireEvent.keyDown(again, { key: "Escape" })
    expect(screen.getByRole("button", { name: "Service filter" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Technician filter, 1 selected" })).toBeInTheDocument()
  })

  it("says when nothing matches, and resets from there", async () => {
    mockBoardApi()
    renderBoard(readingList)
    const list = await table()

    fireEvent.change(screen.getByRole("searchbox", { name: "Search appointments" }), { target: { value: "nobody" } })

    expect(within(list).getByText("No appointments match the search and filters.")).toBeInTheDocument()
    fireEvent.click(within(list).getByRole("button", { name: "Reset filters" }))
    expect(bodyRows(list)).toHaveLength(6)
    expect(screen.getByRole("searchbox", { name: "Search appointments" })).toHaveValue("")
    // The reset took its own button away: focus is on the search field, not the page.
    expect(screen.getByRole("searchbox", { name: "Search appointments" })).toHaveFocus()
  })

  it("hides and shows columns from View", async () => {
    mockBoardApi()
    renderBoard(readingList)
    const list = await table()

    fireEvent.click(screen.getByRole("button", { name: "View" }))
    const menu = await screen.findByRole("menu")
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "VIN" }))

    await waitFor(() => expect(within(list).queryByRole("columnheader", { name: "VIN" })).not.toBeInTheDocument())
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "VIN" }))
    await waitFor(() => expect(within(list).getByRole("columnheader", { name: "VIN" })).toBeInTheDocument())
  })

  it("pages through a long day", async () => {
    mockBoardApi({ schedule: () => longDay() })
    renderBoard(readingList)
    const list = await table()

    expect(bodyRows(list)).toHaveLength(10)
    expect(screen.getByRole("navigation", { name: "Pages" })).toBeInTheDocument()
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("12 appointments")

    fireEvent.click(screen.getByRole("button", { name: "Go to next page" }))

    expect(bodyRows(list)).toHaveLength(2)
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument()
    // Ties keep the bays' order: Bay 1's 13:00 Full Service ends page 1, Bay 3's 13:00 starts page 2.
    expect(columnTexts(list, "Time")).toEqual(["13:00–14:00", "15:00–15:45"])
  })
})

describe("appointments list: actions", () => {
  it("opens the details sheet from a row's actions, marks its row while open, and returns focus to them when it closes", async () => {
    mockBoardApi()
    renderBoard(readingList)
    const list = await table()
    const actions = await actionsFor("Interim Service at 08:00, Sophie Turner")
    // While the modal sheet is open the page is hidden from role queries, so the rows are read from the table itself.
    const selectedRows = () =>
      Array.from(list.querySelectorAll("tbody tr[data-state=selected]"), (row) => row.getAttribute("data-appointment-id"))
    expect(selectedRows()).toEqual([])

    fireEvent.click(actions)
    fireEvent.click(await screen.findByRole("menuitem", { name: "View details" }))

    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    expect(within(sheet).getByText("Tuesday 13 October 2026, 08:00–09:00 (Europe/London)")).toBeInTheDocument()
    expect(await within(sheet).findByRole("link", { name: "sophie.turner@example.com" })).toBeInTheDocument()
    // The row whose details are open is highlighted, as the board's block is.
    expect(selectedRows()).toEqual([appointments.interim.id])

    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    await waitFor(() => expect(actions).toHaveFocus())
    expect(selectedRows()).toEqual([])
  })

  it("opens the details sheet when a row is clicked", async () => {
    mockBoardApi()
    renderBoard(readingList)
    const list = await table()

    fireEvent.click(within(bodyRows(list)[2]).getByText("Emily Clarkson"))

    expect(await screen.findByRole("dialog", { name: "Brake Pads & Discs" })).toBeInTheDocument()
  })

  it("cancels from a row's actions: the sheet opens on the reason, and the row leaves the list", async () => {
    let cancelled = false
    // The day read after the cancellation is held, as on a slow network: the sheet closes while the row is still listed.
    let answer: () => void = () => {}
    const reread = new Promise<void>((resolve) => (answer = resolve))
    const api = mockBoardApi({
      schedule: async () => (cancelled ? (await reread, without(readingTuesday, appointments.interim.id)) : readingTuesday),
      cancel: (_, body) => {
        cancelled = true
        return { ...interimDetails, status: "Cancelled", cancellationReason: String(body.reason) }
      },
    })
    renderBoard(readingList)
    const list = await table()
    const region = screen.getByRole("region", { name: reading.name })
    const actions = await actionsFor("Interim Service at 08:00, Sophie Turner")

    fireEvent.click(actions)
    fireEvent.click(await screen.findByRole("menuitem", { name: "Cancel appointment" }))

    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    const reason = within(sheet).getByRole("textbox", { name: "Reason" })
    await waitFor(() => expect(reason).toHaveFocus())
    fireEvent.change(reason, { target: { value: "Customer rang to rearrange" } })
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel appointment" }))

    expect(await screen.findByText("Appointment cancelled")).toBeInTheDocument()
    const [cancel] = requestsTo(api.requests, "/cancel")
    expect(new URL(cancel.url).pathname).toBe(`/api/v1/appointments/${appointments.interim.id}/cancel`)
    expect(await cancel.clone().json()).toEqual({ reason: "Customer rang to rearrange" })

    // The sheet has closed and the row is still listed, but it is about to leave: focus goes into the list, not back to the
    // row's actions button, which would take focus to the page body with it.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Interim Service" })).not.toBeInTheDocument())
    expect(bodyRows(list)).toHaveLength(6)
    await waitFor(() => expect(region).toContainElement(document.activeElement as HTMLElement))
    expect(actions).not.toHaveFocus()

    answer()
    await waitFor(() => expect(bodyRows(list)).toHaveLength(5))
    expect(columnTexts(list, "Customer")).not.toContain("Sophie Turner")
    expect(region).toContainElement(document.activeElement as HTMLElement)
  })

  it("shows the API's refusal of a cancellation with its trace id, and reads the day again", async () => {
    const api = mockBoardApi({
      cancel: () =>
        problemResponse(409, {
          type: "https://api.keyloop.example/problems/invalid-state-transition",
          title: "Invalid state transition",
          status: 409,
          detail: "Cannot cancel this appointment while it is Cancelled.",
          currentStatus: "Cancelled",
          attempted: "cancel",
          traceId: "00-c891f6205bdf228d5ac20dc267806559-144af9ccbd8f8f2b-01",
        }),
    })
    renderBoard(readingList)
    fireEvent.click(await actionsFor("Interim Service at 08:00, Sophie Turner"))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Cancel appointment" }))
    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    const schedulesBefore = requestsTo(api.requests, "/schedule").length

    fireEvent.change(within(sheet).getByRole("textbox", { name: "Reason" }), { target: { value: "Duplicate booking" } })
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel appointment" }))

    const alert = await within(sheet).findByRole("alert")
    expect(alert).toHaveAttribute("data-tone", "warning")
    expect(within(alert).getByText("Invalid state transition")).toBeInTheDocument()
    expect(within(alert).getByText("00-c891f6205bdf228d5ac20dc267806559-144af9ccbd8f8f2b-01")).toBeInTheDocument()
    await waitFor(() => expect(requestsTo(api.requests, "/schedule").length).toBeGreaterThan(schedulesBefore))
  })

  it("offers no cancellation for work that has started", async () => {
    mockBoardApi({ schedule: () => withStatus(readingTuesday, appointments.evBattery.id, "InProgress") })
    renderBoard(readingList)

    fireEvent.click(await actionsFor("EV Battery Health Check at 09:00, Mohammed Rahman"))

    expect(await screen.findByRole("menuitem", { name: "Cancel appointment" })).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByRole("menuitem", { name: "View details" })).not.toHaveAttribute("aria-disabled")
  })
})

describe("appointments list: the day and the dealership", () => {
  it("moves to another day and keeps it in the address, as the board does", async () => {
    const api = mockBoardApi()
    const { router } = renderBoard(readingList)
    await table()

    fireEvent.click(screen.getByRole("button", { name: "Next day" }))

    await waitFor(() => expect(search(router)).toEqual({ dealership: reading.id, date: "2026-10-14" }))
    await waitFor(() => expect(requestsTo(api.requests, "/schedule").some((request) => request.url.includes("date=2026-10-14"))).toBe(true))
  })

  it("keeps the dealership and the day when moving between the list and the board", async () => {
    mockBoardApi()
    const { router } = renderBoard(`${readingList}&date=2026-10-14`)
    await table()

    const workshop = screen.getByRole("navigation", { name: "Workshop" })
    expect(within(workshop).getByRole("link", { name: "Dispatch board" })).toHaveAttribute(
      "href",
      `/dispatch?dealership=${reading.id}&date=2026-10-14`
    )

    fireEvent.click(within(workshop).getByRole("link", { name: "Dispatch board" }))

    expect(await screen.findByRole("heading", { level: 1, name: "Dispatch board" })).toBeInTheDocument()
    expect(search(router)).toEqual({ dealership: reading.id, date: "2026-10-14" })
    expect(within(screen.getByRole("navigation", { name: "Workshop" })).getByRole("link", { name: "Appointments" })).toHaveAttribute(
      "href",
      `/appointments?dealership=${reading.id}&date=2026-10-14`
    )
  })

  it("keeps the board's own view in the link to the board while it is open, and carries only the day to the list", async () => {
    mockBoardApi()
    renderBoard(`/dispatch?dealership=${reading.id}&date=2026-10-14&lanes=technicians`)
    expect(await screen.findByRole("heading", { level: 2, name: reading.name })).toBeInTheDocument()

    const workshop = screen.getByRole("navigation", { name: "Workshop" })
    expect(within(workshop).getByRole("link", { name: "Dispatch board" })).toHaveAttribute(
      "href",
      `/dispatch?dealership=${reading.id}&date=2026-10-14&lanes=technicians`
    )
    expect(within(workshop).getByRole("link", { name: "Appointments" })).toHaveAttribute(
      "href",
      `/appointments?dealership=${reading.id}&date=2026-10-14`
    )
  })

  it("opens on a dealership with work to show when the address names none", async () => {
    mockBoardApi({ dealerships: () => [munich, reading] })
    const { router } = renderBoard("/appointments")

    expect(await screen.findByRole("heading", { level: 2, name: reading.name })).toBeInTheDocument()
    await waitFor(() => expect(search(router)).toEqual({ dealership: reading.id }))
  })
})

describe("appointments list: empty, closed, loading and failed days", () => {
  it("says a closed day is closed and offers the next open one", async () => {
    mockBoardApi()
    const { router } = renderBoard(`${readingList}&date=2026-10-18`)

    expect(await screen.findByRole("heading", { level: 3, name: "Closed on Sunday 18 October" })).toBeInTheDocument()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Go to Monday 19 October" }))

    await waitFor(() => expect(search(router).date).toBe("2026-10-19"))
  })

  it("offers the board's booking on a day with nothing booked", async () => {
    mockBoardApi()
    renderBoard(`/appointments?dealership=${munich.id}`)

    expect(await screen.findByRole("heading", { level: 3, name: "No appointments today" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Book on the dispatch board" })).toHaveAttribute("href", `/dispatch?dealership=${munich.id}`)
  })

  it("offers no booking on a past day with nothing booked", async () => {
    mockBoardApi()
    renderBoard(`/appointments?dealership=${munich.id}&date=2026-10-12`)

    expect(await screen.findByRole("heading", { level: 3, name: "No appointments on Monday 12 October" })).toBeInTheDocument()
    expect(screen.getByText("Nothing was booked that day.")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Book on the dispatch board" })).not.toBeInTheDocument()
  })

  it("shows a loading list until the day arrives", async () => {
    let answer: () => void = () => {}
    const held = new Promise<void>((resolve) => (answer = resolve))
    mockBoardApi({ schedule: async () => (await held, readingTuesday) })
    renderBoard(readingList)

    expect(await screen.findByText("Loading appointments…")).toBeInTheDocument()
    answer()
    expect(await table()).toBeInTheDocument()
    expect(screen.queryByText("Loading appointments…")).not.toBeInTheDocument()
  })

  it("shows the API's explanation and trace id when the day fails to load, and loads it on retry", async () => {
    let failing = true
    mockBoardApi({
      schedule: () =>
        failing
          ? problemResponse(503, {
              type: "https://api.keyloop.example/problems/internal-error",
              title: "Service unavailable",
              status: 503,
              detail: "The scheduler is starting up. Try again in a moment.",
              traceId: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            })
          : readingTuesday,
    })
    renderBoard(readingList)

    const alert = await screen.findByRole("alert")
    expect(within(alert).getByRole("heading", { name: "Couldn’t load the appointments" })).toBeInTheDocument()
    expect(within(alert).getByText("The scheduler is starting up. Try again in a moment.")).toBeInTheDocument()
    expect(within(alert).getByText("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")).toBeInTheDocument()

    failing = false
    const retry = within(alert).getByRole("button", { name: "Try again" })
    retry.focus()
    fireEvent.click(retry)

    expect(await table()).toBeInTheDocument()
    // The pressed Try again has gone with the failure: focus moves to the list, not to the page body.
    await waitFor(() => expect(screen.getByRole("region", { name: reading.name })).toHaveFocus())
  })
})
