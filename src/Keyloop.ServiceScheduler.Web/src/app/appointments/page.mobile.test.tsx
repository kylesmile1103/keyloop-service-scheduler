import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { mockBoardApi } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { phoneViewport, pointerClick, renderBoard } from "@/test/render-board"
import { appointments, readingTuesday, withStatus } from "@/test/schedules"

// The Appointments page on a phone (< 768 px): job cards instead of the table, the same filters in a bottom sheet.

beforeAll(async () => {
  await import("@/app/appointments/page")
})

beforeEach(() => {
  // Tuesday 2026-10-13, 09:30 in Reading.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
  phoneViewport()
})
afterEach(() => {
  vi.useRealTimers()
})

const readingList = `/appointments?dealership=${reading.id}`
const cards = async () => within(await screen.findByRole("list", { name: "Appointments" })).getAllByRole("button")
const interimLabel = "Interim Service, Bay 1 - Standard, 08:00 to 09:00, Sophie Turner, Amelia Clarke, Confirmed"

describe("appointments list on a phone", () => {
  it("shows the day as job cards by start time, not as a table", async () => {
    mockBoardApi()
    renderBoard(readingList)

    const list = await cards()
    expect(list.map((card) => card.getAttribute("aria-label"))).toEqual([
      interimLabel,
      "EV Battery Health Check, Bay 4 - EV, 09:00 to 10:00, Mohammed Rahman, Ben Okafor, Confirmed",
      "Brake Pads & Discs, Bay 1 - Standard, 10:30 to 12:00, Emily Clarkson, Chloe Nguyen, Confirmed",
      "MOT Test, Bay 6 - MOT, 11:00 to 11:45, Jack Davies, Farid Haddad, Confirmed",
      "Full Service, Bay 1 - Standard, 13:00 to 15:00, Olivia Bennett, Daniel Moss, Confirmed",
      "Four-Wheel Alignment, Bay 2 - Alignment, 15:00 to 15:45, Harry Whitfield, Chloe Nguyen, Confirmed",
    ])
    const [interim] = list
    // Every card names the time, customer, plate and VIN, status, service, and both the bay and the technician.
    expect(interim).toHaveTextContent("08:00–09:00")
    expect(interim).toHaveTextContent("60 min")
    expect(interim).toHaveTextContent("Sophie Turner")
    expect(interim).toHaveTextContent("RF20 BCJ")
    expect(interim).toHaveTextContent("JTDKN3DU0A0123460")
    expect(interim).toHaveTextContent("Confirmed")
    expect(interim).toHaveTextContent("Interim Service")
    expect(interim).toHaveTextContent("Bay 1 - Standard · Amelia Clarke")
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
    // One page holds the day, so there is no previous/next.
    expect(screen.queryByRole("navigation", { name: "Pages" })).not.toBeInTheDocument()
  })

  it("opens a card's details in a bottom sheet", async () => {
    mockBoardApi()
    renderBoard(readingList)
    const [interim] = await cards()

    fireEvent.click(interim)

    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    expect(sheet).toHaveAttribute("data-side", "bottom")
    expect(within(sheet).getByRole("textbox", { name: "Reason" })).toBeInTheDocument()
  })

  it("filters in a bottom sheet and says how many appointments the filters leave", async () => {
    mockBoardApi({ schedule: () => withStatus(readingTuesday, appointments.mot.id, "Completed") })
    renderBoard(readingList)
    await cards()

    fireEvent.click(screen.getByRole("button", { name: "Filters" }))
    const sheet = await screen.findByRole("dialog", { name: "Filter appointments" })
    expect(within(sheet).getByRole("group", { name: "Status" })).toBeInTheDocument()
    expect(within(sheet).getByRole("group", { name: "Bay" })).toBeInTheDocument()
    expect(within(sheet).getByRole("group", { name: "Technician" })).toBeInTheDocument()
    expect(within(sheet).getByRole("group", { name: "Service" })).toBeInTheDocument()

    fireEvent.click(within(within(sheet).getByRole("group", { name: "Status" })).getByRole("checkbox", { name: /^Confirmed/ }))
    fireEvent.click(within(within(sheet).getByRole("group", { name: "Bay" })).getByRole("checkbox", { name: /^Bay 1 - Standard/ }))
    fireEvent.click(within(sheet).getByRole("button", { name: "Show 3 appointments" }))

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Filter appointments" })).not.toBeInTheDocument())
    expect((await cards()).map((card) => card.getAttribute("aria-label")?.split(", ")[0])).toEqual([
      "Interim Service",
      "Brake Pads & Discs",
      "Full Service",
    ])
    expect(screen.getByRole("button", { name: "Filters, 2 active" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Filters, 2 active" }))
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Filter appointments" })).getByRole("button", { name: "Reset filters" }))
    expect(within(screen.getByRole("dialog", { name: "Filter appointments" })).getByRole("button", { name: "Show 6 appointments" })).toBeInTheDocument()
  })

  it("sorts the cards from the filter sheet, as the table's headers do", async () => {
    mockBoardApi()
    renderBoard(readingList)
    const firstWords = async () => (await cards()).map((card) => card.getAttribute("aria-label")?.split(", ")[0])
    const byTime = ["Interim Service", "EV Battery Health Check", "Brake Pads & Discs", "MOT Test", "Full Service", "Four-Wheel Alignment"]
    expect(await firstWords()).toEqual(byTime)

    fireEvent.click(screen.getByRole("button", { name: "Filters" }))
    const sheet = await screen.findByRole("dialog", { name: "Filter appointments" })
    const sortBy = within(sheet).getByRole("combobox", { name: "Sort by" })
    expect(sortBy).toHaveTextContent("Time, earliest first")
    fireEvent.click(sortBy)
    pointerClick(await screen.findByRole("option", { name: "Time, latest first" }))
    await waitFor(() => expect(sortBy).toHaveTextContent("Time, latest first"))
    fireEvent.click(within(sheet).getByRole("button", { name: "Show 6 appointments" }))

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Filter appointments" })).not.toBeInTheDocument())
    expect(await firstWords()).toEqual([...byTime].reverse())
  })

  it("searches by customer, registration or VIN", async () => {
    mockBoardApi()
    renderBoard(readingList)
    await cards()

    fireEvent.change(screen.getByRole("searchbox", { name: "Search appointments" }), { target: { value: "RO14" } })

    expect((await cards()).map((card) => card.getAttribute("aria-label"))).toEqual([
      "MOT Test, Bay 6 - MOT, 11:00 to 11:45, Jack Davies, Farid Haddad, Confirmed",
    ])
  })
})
