import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { WorkshopScheduleResponse } from "@/api/types.gen"
import { mockBoardApi } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { renderBoard, viewportOf } from "@/test/render-board"
import { bodyRows, columnTexts, figure, headers, openFilter } from "@/test/resource-list"
import { appointments, bays, readingSunday, readingTuesday, withStatus } from "@/test/schedules"

// The Bays page (Task 29): the dealership's service bays as a read-only list on Refine core, with today's load.

beforeAll(async () => {
  await Promise.all([import("@/app/admin/layout"), import("@/app/admin/bays/page")])
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

const page = `/resources/bays?dealership=${reading.id}`
const table = () => screen.findByRole("table", { name: "Bays" })

/** Reading's Tuesday with Bay 6 out of service. */
const withMotBayOut: WorkshopScheduleResponse = {
  ...readingTuesday,
  bays: readingTuesday.bays.map((entry) => (entry.id === bays.mot.id ? { ...entry, isActive: false } : entry)),
}

describe("bays list", () => {
  it("lists every bay with its equipment, whether it is in service and today's load", async () => {
    mockBoardApi()
    renderBoard(page)

    const list = await table()
    expect(headers(list)).toEqual(["Bay", "Equipment", "Status", "Appointments today", "Load today"])
    expect(columnTexts(list, "Bay")).toEqual(readingTuesday.bays.map((entry) => entry.name))
    expect(columnTexts(list, "Appointments today")).toEqual(["3", "1", "0", "1", "0", "1"])
    // Booked minutes over the ten opening hours: 270, 45, 0, 60, 0 and 45 of 600.
    expect(columnTexts(list, "Load today")).toEqual(["45%", "8%", "0%", "10%", "0%", "8%"])
    expect(within(bodyRows(list)[4]).getByText("Equipment: Diagnostics, Air-con, Standard lift.")).toBeInTheDocument()
    expect(document.title).toBe("Bays – Keyloop Service Scheduler")
  })

  it("sums the bays as the board does: its bay utilisation, over the bays in service", async () => {
    mockBoardApi({ schedule: () => withMotBayOut })
    renderBoard(page)

    const list = await table()
    expect(figure("Bays")).toHaveTextContent("5 in service, 1 out of service")
    expect(figure("In use today")).toHaveTextContent("3 of 5")
    // The MOT bay's 45 minutes leave the figure with the bay: 375 minutes of five bays' ten hours, as the board's KPI says.
    expect(figure("Booked today")).toHaveTextContent("6 h 15 min")
    expect(figure("Bay utilisation")).toHaveTextContent("13%")
    expect(figure("Bay utilisation")).toHaveTextContent("6 h 15 min booked of 50 h")
    expect(columnTexts(list, "Status")).toEqual(["In service", "In service", "In service", "In service", "In service", "Out of service"])
  })

  it("counts a no-show as an appointment but not as load", async () => {
    mockBoardApi({ schedule: () => withStatus(readingTuesday, appointments.evBattery.id, "NoShow") })
    renderBoard(page)

    const list = await table()
    expect(columnTexts(list, "Appointments today")[3]).toBe("1")
    expect(columnTexts(list, "Load today")[3]).toBe("0%")
  })

  it("filters by equipment and finds a bay by name", async () => {
    mockBoardApi()
    renderBoard(page)

    const list = await table()
    const equipment = await openFilter("Equipment")
    fireEvent.click(within(equipment).getByRole("checkbox", { name: "EV high voltage (1 bay)" }))
    await waitFor(() => expect(columnTexts(list, "Bay")).toEqual(["Bay 4 - EV"]))
    fireEvent.keyDown(equipment, { key: "Escape" })
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }))

    fireEvent.change(screen.getByRole("searchbox", { name: "Search bays" }), { target: { value: "mot" } })
    await waitFor(() => expect(columnTexts(list, "Bay")).toEqual(["Bay 6 - MOT"]))
  })

  it("sorts the most loaded bay first on the second press of Load today", async () => {
    mockBoardApi()
    renderBoard(page)

    const list = await table()
    fireEvent.click(within(list).getByRole("button", { name: "Load today" }))
    fireEvent.click(within(list).getByRole("button", { name: "Load today" }))
    await waitFor(() => expect(columnTexts(list, "Bay")[0]).toBe("Bay 1 - Standard"))
  })

  it("keeps the bays on a closed day and says that none is in use", async () => {
    vi.setSystemTime(new Date("2026-10-18T09:00:00Z"))
    mockBoardApi({ schedule: () => readingSunday })
    renderBoard(page)

    const list = await table()
    expect(bodyRows(list)).toHaveLength(6)
    expect(columnTexts(list, "Load today")).toEqual(Array(6).fill("Closed"))
    expect(figure("Bays")).toHaveTextContent("All in service")
    expect(figure("In use today")).toHaveTextContent("Closed today")
    expect(figure("Booked today")).toHaveTextContent("Closed today")
    expect(figure("Bay utilisation")).toHaveTextContent("Closed today")
    expect(screen.getByText("Closed today (Europe/London).")).toBeInTheDocument()
  })

  it("says an open day is open when there are no bays: nothing booked and no bay time, never closed", async () => {
    mockBoardApi({ schedule: () => ({ ...readingTuesday, technicians: [], bays: [] }) })
    renderBoard(page)

    expect(await screen.findByRole("heading", { name: "No bays yet" })).toBeInTheDocument()
    expect(screen.getByText("Open today 08:00–18:00 (Europe/London).")).toBeInTheDocument()
    expect(figure("Bays")).toHaveTextContent("0None set up yet")
    expect(figure("In use today")).toHaveTextContent("0 of 0No bays in service")
    expect(figure("Booked today")).toHaveTextContent("0 minAcross 0 appointments")
    expect(figure("Bay utilisation")).toHaveTextContent("No bays in service")
    expect(within(figure("Bay utilisation")).getByText("No figure")).toBeInTheDocument()
    expect(screen.queryByText(/closed/i)).not.toBeInTheDocument()
  })

  it("lists the bays as cards on a phone", async () => {
    viewportOf(375)
    mockBoardApi({ schedule: () => withMotBayOut })
    renderBoard(page)

    const cards = await screen.findByRole("list", { name: "Bays" })
    const items = within(cards).getAllByRole("listitem")
    expect(items.map((item) => within(item).getByRole("heading", { level: 3 }).textContent)).toEqual(readingTuesday.bays.map((entry) => entry.name))
    expect(items[0]).toHaveTextContent("3 appointments today")
    expect(items[0]).toHaveTextContent("45% loaded")
    expect(items[5]).toHaveTextContent("Out of service")
  })
})
