import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { WorkshopScheduleResponse } from "@/api/types.gen"
import { mockBoardApi, requestsTo } from "@/test/board-api"
import { munich, reading } from "@/test/dealerships"
import { problemResponse } from "@/test/mock-api"
import { renderBoard, search, viewportOf } from "@/test/render-board"
import { bodyRows, columnTexts, figure, headers, openFilter } from "@/test/resource-list"
import { readingSunday, readingTuesday, technicians } from "@/test/schedules"

// The Technicians page (Task 29): the roster as a read-only list on Refine core, with today's work.

beforeAll(async () => {
  await Promise.all([import("@/app/admin/layout"), import("@/app/admin/technicians/page")])
})

beforeEach(() => {
  // Tuesday 2026-10-13, 09:30 in Reading (BST). Only Date is faked; timers stay real for the UI.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

const page = `/resources/technicians?dealership=${reading.id}`
const table = () => screen.findByRole("table", { name: "Technicians" })
const traceId = "00-438d4c830068d5c9ac8829d1ed9a62c4-688a07bcce305407-01"

/** Reading's Tuesday with Eva Lindqvist no longer taking bookings. */
const withEvaInactive: WorkshopScheduleResponse = {
  ...readingTuesday,
  technicians: readingTuesday.technicians.map((entry) => (entry.id === technicians.eva.id ? { ...entry, isActive: false } : entry)),
}

describe("technicians list", () => {
  it("lists the roster with certifications, active state and today's work, read from today's schedule", async () => {
    const { requests } = mockBoardApi()
    renderBoard(page)

    const list = await table()
    expect(headers(list)).toEqual(["Technician", "Employee no.", "Certified for", "Status", "Appointments today", "Booked today"])
    expect(columnTexts(list, "Technician")).toEqual(["ACAmelia Clarke", "BOBen Okafor", "CNChloe Nguyen", "DMDaniel Moss", "ELEva Lindqvist", "FHFarid Haddad"])
    expect(columnTexts(list, "Employee no.")).toEqual(["T-1001", "T-1002", "T-1003", "T-1004", "T-1005", "T-1006"])
    expect(columnTexts(list, "Appointments today")).toEqual(["1", "1", "2", "1", "0", "1"])
    expect(columnTexts(list, "Booked today")).toEqual(["1 h", "1 h", "2 h 15 min", "2 h", "0 min", "45 min"])
    expect(columnTexts(list, "Status")).toEqual(Array(6).fill("Active"))
    // The certifications are the board's badges, read out once as a list.
    const [amelia] = bodyRows(list)
    expect(within(amelia).getByText("Certified for: Brakes, MOT tester, General service.")).toBeInTheDocument()
    // One read of today's schedule, in the dealership's own calendar; the day and zone are named.
    expect(requestsTo(requests, "/schedule").map((request) => new URL(request.url).search)).toContain("?date=2026-10-13")
    expect(screen.getByRole("heading", { level: 2, name: reading.name })).toBeInTheDocument()
    expect(screen.getByText("Open today 08:00–18:00 (Europe/London).")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("6 technicians")
    expect(document.title).toBe("Technicians – Keyloop Service Scheduler")
  })

  it("is read-only: no control adds, edits or removes a technician", async () => {
    mockBoardApi()
    renderBoard(page)

    await table()
    expect(screen.queryByRole("button", { name: /add|new|edit|delete|remove/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: /name/i })).not.toBeInTheDocument()
  })

  it("sums the roster and today's work in four figures", async () => {
    mockBoardApi({ schedule: () => withEvaInactive })
    renderBoard(page)

    await table()
    expect(figure("Technicians")).toHaveTextContent("6")
    expect(figure("Technicians")).toHaveTextContent("5 active, 1 inactive")
    expect(figure("Working today")).toHaveTextContent("5 of 5")
    expect(figure("Booked today")).toHaveTextContent("7 h")
    expect(figure("Booked today")).toHaveTextContent("Across 6 appointments")
    // 420 booked minutes over five active technicians' ten hours.
    expect(figure("Technician load")).toHaveTextContent("14%")
    expect(figure("Technician load")).toHaveTextContent("7 h booked of 50 h")
    expect(columnTexts(await table(), "Status")).toEqual(["Active", "Active", "Active", "Active", "Inactive", "Active"])
  })

  it("searches by name or employee number", async () => {
    mockBoardApi()
    renderBoard(page)

    const list = await table()
    fireEvent.change(screen.getByRole("searchbox", { name: "Search technicians" }), { target: { value: "t-1005" } })
    await waitFor(() => expect(columnTexts(list, "Technician")).toEqual(["ELEva Lindqvist"]))
    expect(screen.getByRole("status")).toHaveTextContent("1 of 6 technicians")

    fireEvent.change(screen.getByRole("searchbox", { name: "Search technicians" }), { target: { value: "chloe" } })
    await waitFor(() => expect(columnTexts(list, "Technician")).toEqual(["CNChloe Nguyen"]))
  })

  it("filters by certification and by whether they have work today, with counts", async () => {
    mockBoardApi()
    renderBoard(page)

    const list = await table()
    const certified = await openFilter("Certified for")
    expect(within(certified).getByRole("checkbox", { name: "MOT tester (2 technicians)" })).toBeInTheDocument()
    fireEvent.click(within(certified).getByRole("checkbox", { name: "MOT tester (2 technicians)" }))
    await waitFor(() => expect(columnTexts(list, "Technician")).toEqual(["ACAmelia Clarke", "FHFarid Haddad"]))
    fireEvent.keyDown(certified, { key: "Escape" })

    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }))
    const today = await openFilter("Today")
    fireEvent.click(within(today).getByRole("checkbox", { name: "No appointments (1 technician)" }))
    await waitFor(() => expect(columnTexts(list, "Technician")).toEqual(["ELEva Lindqvist"]))
  })

  it("sorts from the column headers, the most booked first on the second press", async () => {
    mockBoardApi()
    renderBoard(page)

    const list = await table()
    const booked = within(list).getByRole("button", { name: "Booked today" })
    fireEvent.click(booked)
    fireEvent.click(booked)
    await waitFor(() => expect(columnTexts(list, "Technician")[0]).toBe("CNChloe Nguyen"))
    expect(within(list).getAllByRole("columnheader").find((cell) => cell.textContent === "Booked today")).toHaveAttribute(
      "aria-sort",
      "descending"
    )
  })

  it("keeps the roster on a closed day and says that nobody works", async () => {
    vi.setSystemTime(new Date("2026-10-18T09:00:00Z"))
    mockBoardApi({ schedule: () => readingSunday })
    renderBoard(page)

    const list = await table()
    expect(bodyRows(list)).toHaveLength(6)
    expect(columnTexts(list, "Booked today")).toEqual(Array(6).fill("Closed"))
    expect(figure("Working today")).toHaveTextContent("Closed today")
    expect(figure("Technician load")).toHaveTextContent("Closed today")
    expect(screen.getByText("Closed today (Europe/London).")).toBeInTheDocument()
  })

  it("says an open day is open when the roster is empty: nothing booked and no technician time, never closed", async () => {
    mockBoardApi({ schedule: () => ({ ...readingTuesday, technicians: [], bays: [] }) })
    renderBoard(page)

    expect(await screen.findByRole("heading", { name: "No technicians yet" })).toBeInTheDocument()
    expect(screen.getByText("Open today 08:00–18:00 (Europe/London).")).toBeInTheDocument()
    expect(figure("Technicians")).toHaveTextContent("0None yet")
    expect(figure("Working today")).toHaveTextContent("0 of 0No active technicians")
    expect(figure("Booked today")).toHaveTextContent("0 minAcross 0 appointments")
    expect(figure("Technician load")).toHaveTextContent("No active technicians")
    expect(within(figure("Technician load")).getByText("No figure")).toBeInTheDocument()
    expect(screen.queryByText(/closed/i)).not.toBeInTheDocument()
  })

  it("says an open day is open when no technician is active: no active technician time to book or measure", async () => {
    mockBoardApi({
      schedule: () => ({ ...readingTuesday, technicians: readingTuesday.technicians.map((entry) => ({ ...entry, isActive: false })) }),
    })
    renderBoard(page)

    await table()
    expect(figure("Technicians")).toHaveTextContent("0 active, 6 inactive")
    expect(figure("Working today")).toHaveTextContent("0 of 0No active technicians")
    // The six appointments stay with their (now inactive) technicians in the list, outside the active roster's figures.
    expect(figure("Booked today")).toHaveTextContent("0 minAcross 0 appointments")
    expect(columnTexts(await table(), "Appointments today")).toEqual(["1", "1", "2", "1", "0", "1"])
    expect(figure("Technician load")).toHaveTextContent("No active technicians")
    expect(screen.queryByText(/closed/i)).not.toBeInTheDocument()
  })

  it("shows the API's words and trace id when the roster cannot be read, and lists it once Try again works", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    let fail = true
    mockBoardApi({
      schedule: (_id, date) =>
        fail
          ? problemResponse(500, {
              type: "https://api.keyloop.example/problems/internal-error",
              title: "An unexpected error occurred.",
              status: 500,
              detail: "The schedule could not be read.",
              traceId,
            })
          : { ...readingTuesday, date },
    })
    renderBoard(page)

    const alert = await screen.findByRole("alert")
    expect(within(alert).getByRole("heading", { name: "Couldn’t load the technicians" })).toBeInTheDocument()
    expect(within(alert).getByText("The schedule could not be read.")).toBeInTheDocument()
    expect(within(alert).getByText(traceId)).toBeInTheDocument()

    fail = false
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }))
    expect(await table()).toBeInTheDocument()
  })

  it("follows the dealership in the address, with the board's default when none is named", async () => {
    mockBoardApi()
    const { router } = renderBoard("/resources/technicians")

    // Reading has work today, München has none: the board's default choice.
    await table()
    await waitFor(() => expect(search(router)).toEqual({ dealership: reading.id }))

    await router.navigate(`/resources/technicians?dealership=${munich.id}`)
    await waitFor(() => expect(columnTexts(screen.getByRole("table", { name: "Technicians" }), "Employee no.")).toEqual(["M-2001", "M-2002", "M-2003"]))
  })

  it("lists the roster as cards on a phone, with the filters in a sheet", async () => {
    viewportOf(390)
    mockBoardApi()
    renderBoard(page)

    const cards = await screen.findByRole("list", { name: "Technicians" })
    const items = within(cards).getAllByRole("listitem")
    expect(items).toHaveLength(6)
    expect(within(items[2]).getByRole("heading", { level: 3, name: "Chloe Nguyen" })).toBeInTheDocument()
    expect(items[2]).toHaveTextContent("T-1003")
    expect(items[2]).toHaveTextContent("2 appointments today")
    expect(items[2]).toHaveTextContent("2 h 15 min booked")
    expect(screen.queryByRole("table")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Filters" }))
    const sheet = await screen.findByRole("dialog", { name: "Filter technicians" })
    fireEvent.click(within(sheet).getByRole("checkbox", { name: "No appointments (1 technician)" }))
    fireEvent.click(within(sheet).getByRole("button", { name: "Show 1 technician" }))
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Technicians" })).getAllByRole("listitem")).toHaveLength(1))
  })
})
