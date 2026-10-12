import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { mockBoardApi, requestsTo } from "@/test/board-api"
import { munichCatalogue, readingCatalogue } from "@/test/catalogue"
import { munich, reading } from "@/test/dealerships"
import { renderBoard, viewportOf } from "@/test/render-board"
import { bodyRows, columnTexts, figure, headers, openFilter } from "@/test/resource-list"

// The Services page (Task 29): the service catalogue as a read-only list on Refine core, with what each needs and
// whether this dealership can book it.

beforeAll(async () => {
  await Promise.all([import("@/app/admin/layout"), import("@/app/admin/services/page")])
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

const table = () => screen.findByRole("table", { name: "Services" })
const catalogues = { serviceTypes: (id: string) => (id === munich.id ? munichCatalogue : readingCatalogue) }

describe("services list", () => {
  it("lists the catalogue with code, duration, needs, whether it is bookable here and today's bookings", async () => {
    viewportOf(1600)
    const { requests } = mockBoardApi(catalogues)
    renderBoard(`/resources/services?dealership=${reading.id}`)

    const list = await table()
    expect(headers(list)).toEqual(["Service", "Code", "Duration", "Needs", "Bookable here", "Booked today"])
    expect(columnTexts(list, "Service")).toEqual(readingCatalogue.map((service) => service.name))
    expect(columnTexts(list, "Code")[0]).toBe("AIRCON-REGAS")
    expect(columnTexts(list, "Duration")).toEqual(["60 min", "90 min", "60 min", "60 min", "90 min", "45 min", "120 min", "180 min", "60 min", "45 min"])
    expect(columnTexts(list, "Bookable here")).toEqual(Array(10).fill("Yes"))
    expect(columnTexts(list, "Booked today")).toEqual(["0", "1", "0", "1", "0", "1", "1", "0", "1", "1"])
    // EV Charging Fault Diagnosis needs an EV bay and a technician with both certifications.
    expect(within(bodyRows(list)[4]).getByText("Needs: EV high voltage, High-voltage electrical, Diagnostics.")).toBeInTheDocument()
    expect(requestsTo(requests, "/service-types")).toHaveLength(1)
    expect(document.title).toBe("Services – Keyloop Service Scheduler")
  })

  it("leaves the code out below 1536 px, where the search still finds it and View brings it back", async () => {
    mockBoardApi(catalogues)
    renderBoard(`/resources/services?dealership=${reading.id}`)

    // 1440 px (the test default): the table fits its card without the code.
    const list = await table()
    expect(headers(list)).toEqual(["Service", "Duration", "Needs", "Bookable here", "Booked today"])
    fireEvent.change(screen.getByRole("searchbox", { name: "Search services" }), { target: { value: "heavy-van" } })
    await waitFor(() => expect(columnTexts(list, "Service")).toEqual(["Heavy Van Service"]))

    fireEvent.click(screen.getByRole("button", { name: "View" }))
    const menu = await screen.findByRole("menu")
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Code" }))
    await waitFor(() => expect(headers(list)).toContain("Code"))
  })

  it("says what this dealership lacks for a service it cannot book", async () => {
    mockBoardApi(catalogues)
    renderBoard(`/resources/services?dealership=${munich.id}`)

    const list = await table()
    const row = (name: string) => bodyRows(list)[columnTexts(list, "Service").indexOf(name)]
    expect(figure("Bookable here")).toHaveTextContent("5 of 10")
    expect(figure("Bookable here")).toHaveTextContent("5 need what this dealership lacks")
    expect(within(row("MOT Test")).getByText("Missing: MOT testing, MOT tester.")).toBeInTheDocument()
    expect(within(row("Diagnostic Fault Finding")).getByText("Missing: Diagnostics.")).toBeInTheDocument()
    // Each need exists here, but on different technicians.
    expect(row("EV Charging Fault Diagnosis")).toHaveTextContent("Not all on one technician")
    expect(within(row("Interim Service")).getByText("Yes")).toBeInTheDocument()
  })

  it("sums the catalogue in four figures", async () => {
    mockBoardApi(catalogues)
    renderBoard(`/resources/services?dealership=${reading.id}`)

    await table()
    expect(figure("Services")).toHaveTextContent("10")
    expect(figure("Bookable here")).toHaveTextContent("10 of 10")
    expect(figure("Bookable here")).toHaveTextContent("Every service can be booked")
    expect(figure("Booked today")).toHaveTextContent("6")
    expect(figure("Booked today")).toHaveTextContent("Across 6 services")
    expect(figure("Durations")).toHaveTextContent("45–180 min")
  })

  it("says an empty catalogue is empty, not that every service can be booked", async () => {
    mockBoardApi({ serviceTypes: () => [] })
    renderBoard(`/resources/services?dealership=${reading.id}`)

    expect(await screen.findByRole("heading", { name: "No services yet" })).toBeInTheDocument()
    expect(figure("Services")).toHaveTextContent("0In the catalogue")
    expect(figure("Bookable here")).toHaveTextContent("0 of 0No services yet")
    expect(figure("Booked today")).toHaveTextContent("Nothing booked")
    expect(screen.queryByText("Every service can be booked")).not.toBeInTheDocument()
  })

  it("finds a service by name or code, and filters by what it needs and whether it is bookable", async () => {
    mockBoardApi(catalogues)
    renderBoard(`/resources/services?dealership=${munich.id}`)

    const list = await table()
    fireEvent.change(screen.getByRole("searchbox", { name: "Search services" }), { target: { value: "ev-charging" } })
    await waitFor(() => expect(columnTexts(list, "Service")).toEqual(["EV Charging Fault Diagnosis"]))
    fireEvent.change(screen.getByRole("searchbox", { name: "Search services" }), { target: { value: "" } })

    const bookable = await openFilter("Bookable here")
    fireEvent.click(within(bookable).getByRole("checkbox", { name: "No (5 services)" }))
    await waitFor(() => expect(bodyRows(list)).toHaveLength(5))
    fireEvent.keyDown(bookable, { key: "Escape" })

    const needs = await openFilter("Needs")
    fireEvent.click(within(needs).getByRole("checkbox", { name: "Diagnostics (2 services)" }))
    await waitFor(() => expect(columnTexts(list, "Service")).toEqual(["Diagnostic Fault Finding", "EV Charging Fault Diagnosis"]))
  })

  it("lists the catalogue as cards on a phone", async () => {
    viewportOf(390)
    mockBoardApi(catalogues)
    renderBoard(`/resources/services?dealership=${munich.id}`)

    const cards = await screen.findByRole("list", { name: "Services" })
    const items = within(cards).getAllByRole("listitem")
    // Ten services, ten a page.
    expect(items).toHaveLength(10)
    const mot = items.find((item) => within(item).queryByRole("heading", { level: 3, name: "MOT Test" }))!
    expect(mot).toHaveTextContent("MOT-TEST")
    expect(mot).toHaveTextContent("45 min")
    expect(mot).toHaveTextContent("Not bookable here")
    expect(within(mot).getByText("Missing: MOT testing, MOT tester.")).toBeInTheDocument()
  })
})
