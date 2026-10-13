import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { mockBoardApi, requestsTo } from "@/test/board-api"
import { munichCatalogue, readingCatalogue } from "@/test/catalogue"
import { munich, reading } from "@/test/dealerships"
import { renderBoard, viewportOf } from "@/test/render-board"
import { bodyRows, columnTexts, figure, figureValue, headers, openFilter } from "@/test/resource-list"

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
    // Eleven services, ten a page: MOT Test, last by name, is on the next.
    expect(columnTexts(list, "Service")).toEqual(readingCatalogue.slice(0, 10).map((service) => service.name))
    expect(columnTexts(list, "Code")[0]).toBe("ACCIDENT-DAMAGE-ASSESSMENT")
    expect(columnTexts(list, "Duration")).toEqual(["60 min", "60 min", "90 min", "60 min", "60 min", "90 min", "45 min", "120 min", "180 min", "60 min"])
    expect(columnTexts(list, "Bookable here")).toEqual(Array(10).fill("Yes"))
    expect(columnTexts(list, "Booked today")).toEqual(["0", "0", "1", "0", "1", "0", "1", "1", "0", "1"])
    expect(within(bodyRows(list)[0]).getByText("Needs: Damage assessment, Standard lift.")).toBeInTheDocument()
    // EV Charging Fault Diagnosis needs an EV bay and a technician with both certifications.
    expect(within(bodyRows(list)[5]).getByText("Needs: EV high voltage, High-voltage electrical, Diagnostics.")).toBeInTheDocument()
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
    expect(figureValue("Bookable here")).toBe("6 of 11")
    expect(figure("Bookable here")).toHaveTextContent("5 need what this dealership lacks")
    expect(within(row("Accident Damage Assessment")).getByText("Yes")).toBeInTheDocument()
    expect(within(row("Diagnostic Fault Finding")).getByText("Missing: Diagnostics.")).toBeInTheDocument()
    // Each need exists here, but on different technicians.
    expect(row("EV Charging Fault Diagnosis")).toHaveTextContent("Not all on one technician")
    expect(within(row("Interim Service")).getByText("Yes")).toBeInTheDocument()
    // MOT Test, last by name, is on the second page of ten.
    fireEvent.click(screen.getByRole("button", { name: "Go to next page" }))
    await waitFor(() => expect(columnTexts(list, "Service")).toEqual(["MOT Test"]))
    expect(within(row("MOT Test")).getByText("Missing: MOT testing, MOT tester.")).toBeInTheDocument()
  })

  it("sums the catalogue in four figures", async () => {
    mockBoardApi(catalogues)
    renderBoard(`/resources/services?dealership=${reading.id}`)

    await table()
    expect(figureValue("Services")).toBe("11")
    expect(figureValue("Bookable here")).toBe("11 of 11")
    expect(figure("Bookable here")).toHaveTextContent("Every service can be booked")
    expect(figureValue("Booked today")).toBe("6")
    expect(figure("Booked today")).toHaveTextContent("Across 6 services")
    expect(figureValue("Durations")).toBe("45–180 min")
  })

  it("says an empty catalogue is empty on an open day: nothing booked, not that every service can be booked", async () => {
    mockBoardApi({ serviceTypes: () => [] })
    renderBoard(`/resources/services?dealership=${reading.id}`)

    expect(await screen.findByRole("heading", { name: "No services yet" })).toBeInTheDocument()
    // An empty catalogue is not an empty roster: it keeps the empty-schedule picture, decorative under its headline.
    expect(document.querySelector('img[src$="/empty-schedule.webp"]')).toHaveAttribute("alt", "")
    expect(screen.queryByRole("img", { name: /locker/ })).not.toBeInTheDocument()
    expect(screen.getByText("Open today 08:00–18:00 (Europe/London).")).toBeInTheDocument()
    expect(figureValue("Services")).toBe("0")
    expect(figure("Services")).toHaveTextContent("In the catalogue")
    expect(figureValue("Bookable here")).toBe("0 of 0")
    expect(figure("Bookable here")).toHaveTextContent("No services yet")
    // Nothing booked on an open day is a count of 0, not a missing figure: only a closed day has none.
    expect(figureValue("Booked today")).toBe("0")
    expect(within(figure("Booked today")).queryByText("No figure")).not.toBeInTheDocument()
    expect(figure("Booked today")).toHaveTextContent("Nothing booked")
    expect(screen.queryByText("Every service can be booked")).not.toBeInTheDocument()
    expect(screen.queryByText(/closed/i)).not.toBeInTheDocument()
  })

  it("keeps the catalogue on a closed day and has no booked figure", async () => {
    vi.setSystemTime(new Date("2026-10-18T09:00:00Z"))
    mockBoardApi(catalogues)
    renderBoard(`/resources/services?dealership=${reading.id}`)

    const list = await table()
    // Eleven services, ten a page.
    expect(bodyRows(list)).toHaveLength(10)
    expect(screen.getByText("Closed today (Europe/London).")).toBeInTheDocument()
    expect(figureValue("Services")).toBe("11")
    expect(figureValue("Booked today")).toBe("–No figure")
    expect(within(figure("Booked today")).getByText("No figure")).toBeInTheDocument()
    expect(figure("Booked today")).toHaveTextContent("Closed today")
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
    // Eleven services, ten a page: MOT Test, last by name, is on the next.
    expect(items).toHaveLength(10)
    const alignment = items.find((item) => within(item).queryByRole("heading", { level: 3, name: "Four-Wheel Alignment" }))!
    expect(alignment).toHaveTextContent("WHEEL-ALIGNMENT")
    expect(alignment).toHaveTextContent("45 min")
    expect(alignment).toHaveTextContent("Not bookable here")
    expect(within(alignment).getByText("Missing: Wheel alignment.")).toBeInTheDocument()
  })
})
