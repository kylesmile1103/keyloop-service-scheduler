import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { mockBoardApi } from "@/test/board-api"
import { munich, reading } from "@/test/dealerships"
import { startCancelling } from "@/test/details"
import { renderBoard, phoneViewport } from "@/test/render-board"

// The phone presentation (< 768 px): the same schedule as an agenda of job cards grouped by lane, details in a bottom sheet,
// and the toolbar's secondary controls in a Filters sheet (task 16 controller addendum: responsive and mobile view).

beforeAll(async () => {
  await import("@/app/dispatch/page")
})

const readingBoard = `/dispatch?dealership=${reading.id}`
// A job card names the customer as well as the technician, as its visible text does (UI_DESIGN 11.13).
const interimLabel = "Interim Service, Bay 1 - Standard, 08:00 to 09:00, Sophie Turner, Amelia Clarke, Confirmed"
const section = (name: string) => screen.findByRole("region", { name: new RegExp(`^${name}`) })

beforeEach(() => {
  // Tuesday 2026-10-13, 09:30 in Reading.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
  phoneViewport()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("dispatch board on a phone", () => {
  it("shows the day as an agenda grouped by bay, not as the timeline grid", async () => {
    mockBoardApi()
    renderBoard(readingBoard)

    const bay1 = await section("Bay 1 - Standard")
    expect(within(bay1).getAllByRole("button", { name: /, Confirmed$/ }).map((card) => card.getAttribute("aria-label"))).toEqual([
      interimLabel,
      "Brake Pads & Discs, Bay 1 - Standard, 10:30 to 12:00, Emily Clarkson, Chloe Nguyen, Confirmed",
      "Full Service, Bay 1 - Standard, 13:00 to 15:00, Olivia Bennett, Daniel Moss, Confirmed",
    ])
    const card = within(bay1).getByRole("button", { name: interimLabel })
    expect(card).toHaveTextContent("08:00–09:00")
    expect(card).toHaveTextContent("Sophie Turner")
    expect(card).toHaveTextContent("RF20 BCJ")
    expect(card).toHaveTextContent("JTDKN3DU0A0123460")
    // In the bay view the card names the technician; the lane already names the bay.
    expect(card).toHaveTextContent("Interim Service · Amelia Clarke")
    expect(screen.queryByRole("group", { name: /^Bay 1/ })).not.toBeInTheDocument()
    expect(within(await section("Bay 3 - Heavy duty")).getByText("No appointments")).toBeInTheDocument()
  })

  it("groups the agenda by technician when that lane view is chosen", async () => {
    mockBoardApi()
    renderBoard(readingBoard)
    await section("Bay 1 - Standard")

    fireEvent.click(screen.getByRole("tab", { name: "Technicians" }))

    const chloe = await section("Chloe Nguyen")
    expect(within(chloe).getAllByRole("button", { name: /, Confirmed$/ })).toHaveLength(2)
  })

  it("marks now between today's past and coming appointments", async () => {
    mockBoardApi()
    renderBoard(readingBoard)

    const bay1 = await section("Bay 1 - Standard")
    const items = within(bay1).getAllByRole("listitem")
    expect(items.map((item) => (item.textContent?.startsWith("Now") ? item.textContent : "card"))).toEqual([
      "card",
      "Now 09:30",
      "card",
      "card",
    ])

    // Another day's agenda has no "now".
    fireEvent.click(screen.getByRole("button", { name: "Next day" }))
    await waitFor(() => expect(screen.getByRole("button", { name: /^Choose date/ })).toHaveTextContent("Wed 14 Oct"))
    await section("Bay 1 - Standard")
    expect(screen.queryByText(/^Now /)).not.toBeInTheDocument()
  })

  it("has no now divider on another day's agenda", async () => {
    mockBoardApi()
    renderBoard(`${readingBoard}&date=2026-10-14`)

    const bay1 = await section("Bay 1 - Standard")
    expect(within(bay1).queryByText(/^Now /)).not.toBeInTheDocument()
    expect(within(bay1).getAllByRole("listitem")).toHaveLength(3)
  })

  it("opens an appointment's details as a bottom sheet", async () => {
    mockBoardApi()
    renderBoard(readingBoard)

    fireEvent.click(within(await section("Bay 1 - Standard")).getByRole("button", { name: interimLabel }))

    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    expect(sheet).toHaveAttribute("data-side", "bottom")
    expect(screen.queryByRole("complementary", { name: "Appointment details" })).not.toBeInTheDocument()
    expect(startCancelling(sheet)).toBeInTheDocument()
    expect(within(sheet).getByRole("button", { name: "Cancel appointment" })).toBeInTheDocument()
  })

  it("keeps auto-refresh, the lane filter and the legend in a Filters sheet", async () => {
    mockBoardApi()
    renderBoard(readingBoard)
    await section("Bay 1 - Standard")
    expect(screen.queryByRole("switch", { name: "Auto-refresh" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Filters" }))

    const filters = await screen.findByRole("dialog", { name: "Board options" })
    expect(filters).toHaveAttribute("data-side", "bottom")
    expect(within(filters).getByRole("switch", { name: "Auto-refresh" })).toBeInTheDocument()
    expect(within(filters).getByText("In progress")).toBeInTheDocument()
    fireEvent.click(within(filters).getByRole("checkbox", { name: "Bay 3 - Heavy duty" }))
    await waitFor(() => expect(screen.queryByRole("region", { name: /^Bay 3/ })).not.toBeInTheDocument())
  })

  it("says when nothing is booked on an open day, instead of a list of empty lanes", async () => {
    mockBoardApi()
    renderBoard(`/dispatch?dealership=${munich.id}`)

    expect(await screen.findByRole("heading", { level: 3, name: "No appointments today" })).toBeInTheDocument()
    expect(document.querySelector('img[src*="empty-schedule"]')).toHaveAttribute("alt", "")
    expect(screen.queryByRole("region", { name: /^Halle 1/ })).not.toBeInTheDocument()
  })

  it("explains a closed day on a phone too", async () => {
    mockBoardApi()
    renderBoard(`${readingBoard}&date=2026-10-18`)

    expect(await screen.findByRole("heading", { level: 3, name: "Closed on Sunday 18 October" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Go to Monday 19 October" })).toBeInTheDocument()
  })
})
