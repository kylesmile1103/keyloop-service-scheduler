import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { AppointmentListItemResponse, CurrentUserResponse } from "@/api/types.gen"
import { NO_ROLE_REASON, READ_ONLY_REASON } from "@/lib/session"
import { mockBoardApi, rangeFromSchedules, requestsTo } from "@/test/board-api"
import { munich, reading } from "@/test/dealerships"
import { expectAvailable, expectUnavailableButFocusable } from "@/test/focus"
import { anonymous, noRole, viewer } from "@/test/identities"
import { problemResponse } from "@/test/mock-api"
import { phoneViewport, pointerClick, renderBoard, search } from "@/test/render-board"
import { appointments, availabilityOn, interimAvailability, interimServiceType } from "@/test/schedules"

beforeAll(async () => {
  await Promise.all([import("@/app/overview/page"), import("@/app/dispatch/page")])
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

const overview = `/overview?dealership=${reading.id}`
const pageHeading = () => screen.findByRole("heading", { level: 1, name: "Overview" })
const card = (label: string) => screen.findByRole("group", { name: label })
const rangeReads = (requests: readonly Request[]) => requestsTo(requests, "/appointments").filter((request) => request.method === "GET")
const rangesRead = (requests: readonly Request[]) => [...new Set(rangeReads(requests).map((request) => new URL(request.url).search))]
const writes = (requests: readonly Request[]) => requests.filter((request) => request.method !== "GET")

function withCancellations(dealershipId: string, from: string, to: string): AppointmentListItemResponse[] {
  return rangeFromSchedules(dealershipId, from, to).map((item) =>
    item.id === appointments.brakes.id || (item.startLocal.startsWith("2026-10-12") && item.serviceType.code === "INTERIM-SERVICE")
      ? { ...item, status: "Cancelled" as const }
      : item
  )
}

describe("the landing page", () => {
  it("is the Overview, keeping the dealership in the address", async () => {
    mockBoardApi()
    const { router } = renderBoard(`/?dealership=${reading.id}`)

    expect(await pageHeading()).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/overview")
    expect(search(router)).toEqual({ dealership: reading.id })
    expect(document.title).toBe("Overview – Keyloop Service Scheduler")
  })

  it("chooses a dealership with work when the address names none, as the board does", async () => {
    mockBoardApi()
    const { router } = renderBoard("/")

    await pageHeading()
    await waitFor(() => expect(search(router)).toEqual({ dealership: reading.id }))
  })
})

describe("the range read", () => {
  it("reads the 14 days before today to the 14 after, once, with every status", async () => {
    const { requests } = mockBoardApi()
    renderBoard(overview)

    await screen.findByRole("region", { name: "Bookings per day" })
    expect(rangesRead(requests)).toEqual(["?from=2026-09-29&to=2026-10-27"])
    expect(new URL(rangeReads(requests)[0].url).pathname).toBe(`/api/v1/dealerships/${reading.id}/appointments`)
  })

  it("counts days on the dealership's calendar, not the browser's", async () => {
    vi.setSystemTime(new Date("2026-10-13T22:30:00Z"))
    const { requests } = mockBoardApi()
    renderBoard(`/overview?dealership=${munich.id}`)

    await waitFor(() => expect(rangesRead(requests)).toEqual(["?from=2026-09-30&to=2026-10-28"]))
  })
})

describe("today's figures", () => {
  it("shows today's bookings by status, bay utilisation, the week's cancellations and the next free start", async () => {
    mockBoardApi({ serviceTypes: () => [interimServiceType] })
    renderBoard(overview)

    const booked = await card("Booked today")
    await waitFor(() => expect(within(booked).getByText("6")).toBeInTheDocument())
    expect(within(booked).getByText("6 confirmed")).toBeInTheDocument()

    const utilisation = await card("Bay utilisation today")
    await waitFor(() => expect(within(utilisation).getByText("12%")).toBeInTheDocument())
    expect(within(utilisation).getByText("7 h booked of 60 h across 6 bays")).toBeInTheDocument()

    const cancelled = await card("Cancelled, last 7 days")
    expect(within(cancelled).getByText("0")).toBeInTheDocument()
    expect(within(cancelled).getByText("None of 36 appointments due")).toBeInTheDocument()

    const next = await card("Next free start")
    await waitFor(() => expect(within(next).getByText("10:15")).toBeInTheDocument())
    expect(within(next).getByText("Today, 4 bays and 3 technicians free")).toBeInTheDocument()
    expect(within(next).getByText("Interim Service, 60 min")).toBeInTheDocument()
  })

  it("leaves cancelled appointments out of today's bookings and counts them as the week's cancellations", async () => {
    mockBoardApi({ range: withCancellations })
    renderBoard(overview)

    const booked = await card("Booked today")
    await waitFor(() => expect(within(booked).getByText("5")).toBeInTheDocument())
    expect(within(booked).getByText("5 confirmed; 1 cancelled not counted")).toBeInTheDocument()
    const cancelled = await card("Cancelled, last 7 days")
    expect(within(cancelled).getByText("2")).toBeInTheDocument()
    expect(within(cancelled).getByText("2 of 36 appointments due")).toBeInTheDocument()
  })

  it("names the next open day's first free start when today has none left", async () => {
    mockBoardApi({
      availability: (_, __, date) => (date === "2026-10-13" ? { ...interimAvailability, slots: [] } : availabilityOn(date)),
    })
    renderBoard(overview)

    const next = await card("Next free start")
    await waitFor(() => expect(within(next).getByText("Wed 10:15")).toBeInTheDocument())
    expect(within(next).getByText("Wednesday 14 October, 4 bays and 3 technicians free")).toBeInTheDocument()
  })

  it("says Closed today for the utilisation on a day the dealership does not open", async () => {
    vi.setSystemTime(new Date("2026-10-18T09:00:00Z"))
    mockBoardApi()
    renderBoard(overview)

    const utilisation = await card("Bay utilisation today")
    await waitFor(() => expect(within(utilisation).getByText("Closed today")).toBeInTheDocument())
    expect(within(utilisation).getByText("No figure")).toBeInTheDocument()
  })
})

describe("bookings per day", () => {
  it("draws the fortnight either side of today with a written summary as its description", async () => {
    mockBoardApi()
    renderBoard(overview)

    const chart = await screen.findByRole("img", { name: "Bookings per day from Tuesday 29 September to Tuesday 27 October 2026" })
    expect(chart).toHaveAccessibleDescription(
      "72 in the last 14 days, 6 today and 72 booked so far for the next 14. Busiest: Tuesday 29 September, with 6."
    )
    expect(within(chart).getAllByText("Today").length).toBeGreaterThan(0)
  })

  it("shows the same numbers as a table, each day linking to its board, closed days said in words", async () => {
    mockBoardApi()
    renderBoard(overview)

    const region = await screen.findByRole("region", { name: "Bookings per day" })
    fireEvent.click(within(region).getByRole("tab", { name: "Table" }))

    const table = await within(region).findByRole("table", { name: "Bookings per day, cancellations left out" })
    const rows = within(table).getAllByRole("row").slice(1)
    expect(rows).toHaveLength(29)
    expect(rows[0]).toHaveTextContent("Tue 29 Sept6")
    const today = rows[14]
    expect(today).toHaveTextContent("Tue 13 OctToday6")
    expect(within(today).getByRole("link", { name: "Tue 13 Oct" })).toHaveAttribute("href", `/dispatch?dealership=${reading.id}`)
    const sunday = rows[19]
    expect(sunday).toHaveTextContent("Sun 18 OctClosed")
    expect(within(sunday).getByRole("link", { name: "Sun 18 Oct" })).toHaveAttribute("href", `/dispatch?dealership=${reading.id}&date=2026-10-18`)
  })

  it("makes each day's link in the table a 44 px row-high touch target on a coarse pointer and below md", async () => {
    mockBoardApi()
    renderBoard(overview)

    const region = await screen.findByRole("region", { name: "Bookings per day" })
    fireEvent.click(within(region).getByRole("tab", { name: "Table" }))
    const link = within(await within(region).findByRole("table")).getByRole("link", { name: "Fri 16 Oct" })

    for (const size of ["pointer-coarse:min-h-11", "max-md:min-h-11"]) expect(link).toHaveClass(size)
    for (const padding of ["pointer-coarse:py-0", "max-md:py-0"]) expect(link.closest("td")).toHaveClass(padding)
  })
})

describe("the service mix", () => {
  it("lists bookings by service with each count and share written out", async () => {
    mockBoardApi({ range: withCancellations })
    renderBoard(overview)

    const region = await screen.findByRole("region", { name: "Service mix" })
    const items = await within(region).findAllByRole("listitem")
    // 150 appointments, two cancelled: 25 of each service but one fewer brakes and interim.
    expect(items.map((item) => item.textContent)).toEqual([
      "EV Battery Health Check25 bookings, · 17%",
      "Four-Wheel Alignment25 bookings, · 17%",
      "Full Service25 bookings, · 17%",
      "MOT Test25 bookings, · 17%",
      "Brake Pads & Discs24 bookings, · 16%",
      "Interim Service24 bookings, · 16%",
    ])
  })
})

describe("upcoming appointments", () => {
  it("lists the work still to finish, soonest first, and opens a row's details in the board's sheet", async () => {
    mockBoardApi()
    renderBoard(overview)

    const region = await screen.findByRole("region", { name: "Upcoming appointments" })
    const rows = await within(region).findAllByRole("button")
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      // Under way since 09:00: it stays until it ends.
      "Today, EV Battery Health Check, Bay 4 - EV, 09:00 to 10:00, Mohammed Rahman, Ben Okafor, Confirmed",
      "Today, Brake Pads & Discs, Bay 1 - Standard, 10:30 to 12:00, Emily Clarkson, Chloe Nguyen, Confirmed",
      "Today, MOT Test, Bay 6 - MOT, 11:00 to 11:45, Jack Davies, Farid Haddad, Confirmed",
      "Today, Full Service, Bay 1 - Standard, 13:00 to 15:00, Olivia Bennett, Daniel Moss, Confirmed",
      "Today, Four-Wheel Alignment, Bay 2 - Alignment, 15:00 to 15:45, Harry Whitfield, Chloe Nguyen, Confirmed",
      "Tomorrow, Interim Service, Bay 1 - Standard, 08:00 to 09:00, Sophie Turner, Amelia Clarke, Confirmed",
    ])
    expect(within(region).getByRole("link", { name: "Open calendar" })).toHaveAttribute("href", `/calendar?dealership=${reading.id}`)

    rows[1].focus()
    fireEvent.click(rows[1])
    const sheet = await screen.findByRole("dialog", { name: "Brake Pads & Discs" })
    // The whole record, read for a Service advisor.
    expect(await within(sheet).findByText("customer@example.com")).toBeInTheDocument()
    fireEvent.keyDown(sheet, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    await waitFor(() => expect(rows[1]).toHaveFocus())
  })

  it("shows a visitor the names, VINs and plates masked as the API sends them, and reads no record", async () => {
    const masked = (item: AppointmentListItemResponse): AppointmentListItemResponse => ({
      ...item,
      customerName: item.customerName.split(" ").map((part) => part[0]).join(""),
      vin: `***********${item.vin.slice(-6)}`,
      registration: "*******",
    })
    const { requests } = mockBoardApi({ me: () => anonymous, range: (id, from, to) => rangeFromSchedules(id, from, to).map(masked) })
    renderBoard(overview)

    const region = await screen.findByRole("region", { name: "Upcoming appointments" })
    const [first] = await within(region).findAllByRole("button")
    expect(first).toHaveAccessibleName("Today, EV Battery Health Check, Bay 4 - EV, 09:00 to 10:00, MR, Ben Okafor, Confirmed")
    expect(within(first).getByText("*******")).toBeInTheDocument()

    fireEvent.click(first)
    const sheet = await screen.findByRole("dialog", { name: "EV Battery Health Check" })
    expect(within(sheet).getByRole("heading", { name: "Sign in to see the whole booking" })).toBeInTheDocument()
    expect(requests.filter((request) => /\/api\/v1\/appointments\//.test(request.url))).toHaveLength(0)
  })
})

describe("quick actions", () => {
  it("opens the dispatch board on this dealership, today", async () => {
    mockBoardApi()
    const { router } = renderBoard(`${overview}&date=2026-10-20`)

    const link = await screen.findByRole("link", { name: "Open dispatch board" })
    expect(link).toHaveAttribute("href", `/dispatch?dealership=${reading.id}`)
    fireEvent.click(link)
    expect(await screen.findByRole("heading", { level: 1, name: "Dispatch board" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/dispatch")
  })

  it("books from Book appointment, starting today, then reads the range again and offers the booking on its board", async () => {
    const { requests } = mockBoardApi({ serviceTypes: () => [interimServiceType] })
    const { router } = renderBoard(overview)

    const book = await screen.findByRole("button", { name: "Book appointment" })
    expectAvailable(book)
    await screen.findByRole("region", { name: "Bookings per day" })
    fireEvent.click(book)
    const dialog = await screen.findByRole("dialog", { name: "Book appointment" })
    expect(within(dialog).getByRole("button", { name: "Date, Tuesday 13 October 2026" })).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole("combobox", { name: "Service" }))
    pointerClick(await screen.findByRole("option", { name: /^Interim Service/ }))
    fireEvent.click(await within(dialog).findByRole("radio", { name: "10:15, 4 bays and 3 technicians free" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }))
    await within(dialog).findByRole("heading", { name: "Customer and vehicle" })
    const values = { Name: "Grace Hopper", Email: "grace@example.com", Phone: "+44 7700 900123", VIN: "WVWZZZ1KZAW654321", Registration: "RK22 ABC", Make: "Volkswagen", Model: "Golf" }
    for (const [label, value] of Object.entries(values)) fireEvent.change(within(dialog).getByRole("textbox", { name: label }), { target: { value } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))

    const toast = (await screen.findByText("Booked")).closest<HTMLElement>("[data-slot=toast]")!
    // The range is read again once the booking is made.
    const booking = requests.findIndex((request) => request.method === "POST")
    await waitFor(() => expect(requests.slice(booking + 1).some((request) => rangeReads([request]).length === 1)).toBe(true))
    fireEvent.click(within(toast).getByRole("button", { name: "View on board" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/dispatch"))
    expect(search(router)).toEqual({ dealership: reading.id })
  })

  it("asks a visitor who is not signed in to sign in, and sends nothing", async () => {
    const { requests } = mockBoardApi({ me: () => anonymous })
    renderBoard(overview)

    const book = await screen.findByRole("button", { name: "Book appointment" })
    expectAvailable(book)
    fireEvent.click(book)

    expect(await screen.findByRole("dialog", { name: "Sign in to book" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Book appointment" })).not.toBeInTheDocument()
    expect(writes(requests)).toHaveLength(0)
  })

  it.each<[string, CurrentUserResponse, string]>([
    ["a Viewer", viewer, READ_ONLY_REASON],
    ["an account without a role", noRole, NO_ROLE_REASON],
  ])("shows %s Book appointment unavailable, with the reason on screen and read with it", async (_, me, reason) => {
    const { requests } = mockBoardApi({ me: () => me })
    renderBoard(overview)

    const book = await screen.findByRole("button", { name: "Book appointment" })
    expectUnavailableButFocusable(book)
    const note = document.getElementById(book.getAttribute("aria-describedby")!)
    expect(note).toHaveTextContent(reason)
    expect(note).toBeVisible()
    fireEvent.click(book)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(writes(requests)).toHaveLength(0)
  })

  it("opens the booking as a full-screen sheet on a phone", async () => {
    phoneViewport()
    mockBoardApi()
    renderBoard(overview)

    fireEvent.click(await screen.findByRole("button", { name: "Book appointment" }))
    expect(await screen.findByRole("dialog", { name: "Book appointment" })).toBeInTheDocument()
  })
})

describe("empty and failed states", () => {
  it("shows the dashboard illustration with its alt text when nothing is booked around today, with Book appointment", async () => {
    mockBoardApi({ range: () => [] })
    renderBoard(overview)

    expect(await screen.findByRole("heading", { level: 2, name: "Nothing booked around today" })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "Workshop bay silhouette with rising blue bars and a simple gauge." })).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Book appointment" })).toHaveLength(2)
    expect(within(await card("Booked today")).getByText("Nothing booked")).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Bookings per day" })).not.toBeInTheDocument()
  })

  it("says the appointments could not be loaded, keeps the figures that did, and recovers with Try again", async () => {
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
    renderBoard(overview)

    const alert = await screen.findByRole("alert")
    expect(within(alert).getByRole("heading", { name: "Couldn’t load the appointments" })).toBeInTheDocument()
    expect(within(await card("Booked today")).getByText("No figure")).toBeInTheDocument()
    expect(within(await card("Booked today")).getByText("Unavailable")).toBeInTheDocument()
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Bay utilisation today" })).getByText("12%")).toBeInTheDocument())

    fail = false
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }))
    expect(await screen.findByRole("region", { name: "Bookings per day" })).toBeInTheDocument()
  })
})

describe("navigation", () => {
  it("lists the Overview first among the Workshop pages, carrying the dealership but not the day", async () => {
    mockBoardApi()
    renderBoard(`/dispatch?dealership=${reading.id}&date=2026-10-14`)
    await screen.findByRole("heading", { level: 1, name: "Dispatch board" })

    const workshop = screen.getByRole("navigation", { name: "Workshop" })
    const links = within(workshop).getAllByRole("link")
    expect(links[0]).toHaveTextContent("Overview")
    expect(links[0]).toHaveAttribute("href", `/overview?dealership=${reading.id}`)
  })

  it("keeps the dealership chosen on the Overview when moving to another workshop page", async () => {
    mockBoardApi()
    const { router } = renderBoard(`/overview?dealership=${munich.id}`)
    await pageHeading()

    const workshop = screen.getByRole("navigation", { name: "Workshop" })
    fireEvent.click(within(workshop).getByRole("link", { name: "Appointments" }))
    expect(await screen.findByRole("heading", { level: 1, name: "Appointments" })).toBeInTheDocument()
    expect(search(router)).toEqual({ dealership: munich.id })
  })
})
