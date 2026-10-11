import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { BookAppointmentRequest, WorkshopScheduleResponse } from "@/api/types.gen"
import * as telemetry from "@/lib/telemetry"
import { bookedFrom, mockBoardApi, scheduledFrom } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { jsonResponse, problemResponse } from "@/test/mock-api"
import { phoneViewport, pointerClick, renderBoard, search } from "@/test/render-board"
import { bays, interimServiceType, readingTuesday, technicians } from "@/test/schedules"

/** A service that needs a capability and a certification of the same name, as the seeded catalogue's diagnostics does. */
const diagnosticsServiceType = {
  id: "d6a338d4-79ae-8409-988d-97397cca4b3f",
  code: "DIAG-FAULT-FINDING",
  name: "Diagnostic Fault Finding",
  durationMinutes: 60,
  requiredBayCapabilities: ["Diagnostics" as const],
  requiredCertifications: ["Diagnostics" as const],
  bookable: true,
}

// The booking dialog (Task 17): two steps, slot chips from the availability read, the problem UX and the idempotency key.

vi.mock("@/lib/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/telemetry")>()
  return { ...actual, withSpan: vi.fn(actual.withSpan) }
})

beforeAll(async () => {
  await import("@/app/dispatch/page")
})

const readingBoard = `/dispatch?dealership=${reading.id}`
const problems = "https://api.keyloop.example/problems/"

beforeEach(() => {
  // Tuesday 2026-10-13, 09:30 in Reading (BST). Only Date is faked; timers stay real for the UI.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

const dialog = () => screen.findByRole("dialog", { name: "Book appointment" })

async function openDialog() {
  fireEvent.click(await screen.findByRole("button", { name: "Book appointment" }))
  return dialog()
}

/** Step 1: Interim Service at 10:15 on the board's day. */
async function chooseInterimAt1015(scope: HTMLElement) {
  fireEvent.click(within(scope).getByRole("combobox", { name: "Service" }))
  pointerClick(await screen.findByRole("option", { name: /^Interim Service/ }))
  const chip = await within(scope).findByRole("radio", { name: "10:15, 4 bays and 3 technicians free" })
  fireEvent.click(chip)
  await waitFor(() => expect(chip).toHaveAttribute("aria-checked", "true"))
}

/** Step 2: a customer and a vehicle (the VIN typed in lower case). */
function fillCustomerAndVehicle(scope: HTMLElement, overrides: Partial<Record<string, string>> = {}) {
  const values: Record<string, string> = {
    Name: "Grace Hopper",
    Email: "grace.hopper@example.com",
    Phone: "+44 7700 900123",
    VIN: "wvwzzz1kzaw654321",
    Registration: "rk22 abc",
    Make: "Volkswagen",
    Model: "Golf",
    ...overrides,
  }
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(within(scope).getByRole("textbox", { name: label }), { target: { value } })
  }
}

async function goToStepTwo(scope: HTMLElement) {
  await chooseInterimAt1015(scope)
  fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
  await within(scope).findByRole("heading", { name: "Customer and vehicle" })
}

const bookingRequests = (requests: readonly Request[]) =>
  requests.filter((request) => request.method === "POST" && new URL(request.url).pathname.endsWith("/appointments"))
const bodyOf = async (request: Request) => (await request.clone().json()) as BookAppointmentRequest

const slotUnavailable = {
  type: `${problems}slot-unavailable`,
  title: "Slot unavailable",
  status: 409,
  detail: "Every qualified bay or technician is busy at 10:15.",
  traceId: "00-5d2c3f0a7e1b4c8d9e0f1a2b3c4d5e6f-1a2b3c4d5e6f7a8b-01",
  suggestedSlots: [
    { startUtc: "2026-10-13T09:30:00Z", endUtc: "2026-10-13T10:30:00Z", startLocal: "2026-10-13T10:30+01:00" },
    { startUtc: "2026-10-13T10:00:00Z", endUtc: "2026-10-13T11:00:00Z", startLocal: "2026-10-13T11:00+01:00" },
  ],
}

describe("booking an appointment", () => {
  it("books in two steps from the toolbar, then shows the allocation and highlights the new block", async () => {
    let booked: WorkshopScheduleResponse | null = null
    const consoleError = vi.spyOn(console, "error")
    const api = mockBoardApi({
      serviceTypes: () => [interimServiceType, diagnosticsServiceType],
      schedule: () => booked ?? readingTuesday,
      book: (_, body) => {
        const appointment = bookedFrom(body, { bay: bays.heavy, technician: technicians.ben })
        booked = {
          ...readingTuesday,
          bays: readingTuesday.bays.map((bay) =>
            bay.id === bays.heavy.id ? { ...bay, appointments: [scheduledFrom(appointment)] } : bay
          ),
        }
        return appointment
      },
    })
    renderBoard(readingBoard)
    const scope = await openDialog()

    // Step 1 of 2, with the stepper saying so.
    expect(within(scope).getByRole("listitem", { current: "step" })).toHaveTextContent("Service & time")
    await chooseInterimAt1015(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))

    const heading = await within(scope).findByRole("heading", { name: "Customer and vehicle" })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(within(scope).getByRole("listitem", { current: "step" })).toHaveTextContent("Customer & vehicle")
    expect(within(scope).getByText("Tue 13 Oct, 10:15 to 11:15 · 60 min")).toBeInTheDocument()
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    // The toast names the allocation, with a way to the block.
    const toast = await screen.findByText("Booked")
    const toastRoot = toast.closest<HTMLElement>("[data-slot=toast]")!
    expect(within(toastRoot).getByText("Interim Service at 10:15 · Bay 3 - Heavy duty · Ben Okafor")).toBeInTheDocument()
    expect(within(toastRoot).getByRole("button", { name: "View on board" })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Book appointment" })).not.toBeInTheDocument())

    const [request] = bookingRequests(api.requests)
    expect(await bodyOf(request)).toEqual({
      serviceTypeId: "3153f30d-5700-8f07-a25d-4a4ea44dfeef",
      startUtc: "2026-10-13T09:15:00Z",
      customer: { name: "Grace Hopper", email: "grace.hopper@example.com", phone: "+44 7700 900123" },
      vehicle: { vin: "WVWZZZ1KZAW654321", registration: "RK22 ABC", make: "Volkswagen", model: "Golf" },
    })
    expect(request.headers.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/)

    // The board reads the day again and the new block draws the booked halo.
    const block = await screen.findByRole("button", { name: /^Interim Service, Bay 3 - Heavy duty, 10:15 to 11:15/ })
    expect(block).toHaveAttribute("data-booked")
    expect(telemetry.withSpan).toHaveBeenCalledWith("ui.book_appointment", expect.any(Function), expect.any(Object))
    expect(consoleError).not.toHaveBeenCalled()
  })

  it("asks for a start time before going on, and checks the VIN as the API does before sending", async () => {
    const api = mockBoardApi()
    renderBoard(readingBoard)
    const scope = await openDialog()

    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    expect(await within(scope).findByText("Choose a service")).toBeInTheDocument()

    await chooseInterimAt1015(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    await within(scope).findByRole("heading", { name: "Customer and vehicle" })
    fillCustomerAndVehicle(scope, { VIN: "WVWZZZ1KZAW65432I" })
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    expect(await within(scope).findByText("VIN must be 17 characters (no I, O, Q)")).toBeInTheDocument()
    expect(within(scope).getByRole("textbox", { name: "VIN" })).toHaveAttribute("aria-invalid", "true")
    expect(bookingRequests(api.requests)).toHaveLength(0)
  })

  it("asks for a start time once the service is chosen", async () => {
    mockBoardApi()
    renderBoard(readingBoard)
    const scope = await openDialog()
    fireEvent.click(within(scope).getByRole("combobox", { name: "Service" }))
    pointerClick(await screen.findByRole("option", { name: /^Interim Service/ }))
    await within(scope).findByRole("radio", { name: /^10:15/ })

    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))

    expect(await within(scope).findByText("Pick a start time")).toBeInTheDocument()
    expect(within(scope).getByRole("heading", { name: "Service and time" })).toBeInTheDocument()
  })

  it("offers the API's suggested starts when the slot was just taken, and books one with the same idempotency key", async () => {
    let attempts = 0
    const api = mockBoardApi({
      book: (_, body) => (++attempts === 1 ? problemResponse(409, slotUnavailable) : bookedFrom(body)),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await goToStepTwo(scope)
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    const alert = await within(scope).findByRole("alert")
    expect(alert).toHaveAttribute("data-tone", "warning")
    expect(within(alert).getByText("Slot just taken - pick another time")).toBeInTheDocument()
    expect(within(alert).getByText(slotUnavailable.detail)).toBeInTheDocument()
    expect(within(alert).getByText(slotUnavailable.traceId)).toBeInTheDocument()

    fireEvent.click(within(alert).getByRole("button", { name: "Book at 10:30 instead" }))

    await screen.findByText("Booked")
    const [first, second] = bookingRequests(api.requests)
    expect((await bodyOf(second)).startUtc).toBe("2026-10-13T09:30:00Z")
    expect(second.headers.get("Idempotency-Key")).toBe(first.headers.get("Idempotency-Key"))
  })

  it("explains a refused business rule and names what the dealership is missing", async () => {
    mockBoardApi({
      book: () =>
        problemResponse(422, {
          type: `${problems}no-qualified-resources`,
          title: "No qualified resources",
          status: 422,
          detail: "No active bay or technician here can perform this service.",
          traceId: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
          missingCapabilities: ["EvHighVoltage", "AirConditioning"],
          missingCertifications: ["AirConditioning"],
        }),
    })
    const consoleError = vi.spyOn(console, "error")
    renderBoard(readingBoard)
    const scope = await openDialog()
    await goToStepTwo(scope)
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    const alert = await within(scope).findByRole("alert")
    expect(alert).toHaveAttribute("data-tone", "warning")
    expect(within(alert).getByText("No qualified resources")).toBeInTheDocument()
    expect(within(alert).getByText("EV high voltage")).toBeInTheDocument()
    // A missing capability and certification of the same name are two badges, and React keeps them apart.
    expect(within(alert).getAllByText("Air-con")).toHaveLength(2)
    expect(consoleError).not.toHaveBeenCalled()
  })

  it("sends the user back to pick another time when the time breaks a rule", async () => {
    mockBoardApi({
      book: () =>
        problemResponse(422, {
          type: `${problems}slot-not-aligned`,
          title: "Start time not on the slot grid",
          status: 422,
          detail: "Starts are every 15 minutes from opening.",
          traceId: "00-1af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
          slotGranularityMinutes: 15,
        }),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await goToStepTwo(scope)
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    fireEvent.click(await within(scope).findByRole("button", { name: "Pick another time" }))

    expect(await within(scope).findByRole("heading", { name: "Service and time" })).toBeInTheDocument()
    expect(within(scope).getByRole("radio", { name: /^10:15/ })).toHaveAttribute("aria-checked", "false")
  })

  it("puts the API's field errors on their fields", async () => {
    mockBoardApi({
      book: () =>
        problemResponse(400, {
          type: `${problems}validation-error`,
          title: "Validation failed",
          status: 400,
          detail: "One or more fields are invalid.",
          traceId: "00-2af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
          errors: { "customer.email": ["Email is not a valid address."], "Vehicle.Vin": ["VIN check digit is wrong."] },
        }),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await goToStepTwo(scope)
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    expect(await within(scope).findByText("Email is not a valid address.")).toBeInTheDocument()
    expect(within(scope).getByText("VIN check digit is wrong.")).toBeInTheDocument()
    expect(within(scope).getByRole("textbox", { name: "Email" })).toHaveAttribute("aria-invalid", "true")
    expect(within(scope).getByRole("textbox", { name: "VIN" })).toHaveAttribute("aria-invalid", "true")
    // Every message is under its field, so nothing else is announced above the form.
    expect(within(scope).queryByText("Check the highlighted details")).not.toBeInTheDocument()
  })

  it("shows a field error that no field owns above the form", async () => {
    mockBoardApi({
      book: () =>
        problemResponse(400, {
          type: `${problems}validation-error`,
          title: "Validation failed",
          status: 400,
          detail: "One or more fields are invalid.",
          traceId: "00-4af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
          errors: { "Idempotency-Key": ["Idempotency-Key must be 1 to 64 letters, digits, '-' or '_'."] },
        }),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await goToStepTwo(scope)
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    const alert = await within(scope).findByRole("alert")
    expect(within(alert).getByText("Check the highlighted details")).toBeInTheDocument()
    expect(within(alert).getByText("Idempotency-Key must be 1 to 64 letters, digits, '-' or '_'.")).toBeInTheDocument()
  })

  it("says when the server failed, and tries again safely with the same booking and key", async () => {
    let attempts = 0
    const api = mockBoardApi({
      book: (_, body) =>
        ++attempts === 1 ? new Response("", { status: 503, statusText: "Service Unavailable" }) : bookedFrom(body),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await goToStepTwo(scope)
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    expect(await screen.findByText("Couldn’t book the appointment", { selector: "[data-slot=toast-title]" })).toBeInTheDocument()
    expect(screen.getByText(/The server answered 503\./)).toBeInTheDocument()
    const alert = await within(scope).findByRole("alert")
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }))

    await screen.findByText("Booked")
    const [first, second] = bookingRequests(api.requests)
    expect(await bodyOf(second)).toEqual(await bodyOf(first))
    expect(second.headers.get("Idempotency-Key")).toBe(first.headers.get("Idempotency-Key"))
  })

  it("waits out a rate limit before it books again", async () => {
    mockBoardApi({
      book: () =>
        problemResponse(429, {
          type: `${problems}rate-limited`,
          title: "Too many requests",
          status: 429,
          detail: "Too many bookings from this client.",
          traceId: "00-3af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
          retryAfterSeconds: 5,
        }),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await goToStepTwo(scope)
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    const alert = await within(scope).findByRole("alert")
    expect(alert).toHaveAttribute("data-tone", "info")
    expect(within(alert).getByText(/^Too many requests - try again in \d s$/)).toBeInTheDocument()
    expect(within(scope).getByRole("button", { name: /^Book \(in \d s\)$/ })).toBeDisabled()
  })

  it("starts the next booking with a new idempotency key", async () => {
    const api = mockBoardApi()
    renderBoard(readingBoard)
    for (let round = 0; round < 2; round++) {
      const scope = await openDialog()
      await goToStepTwo(scope)
      fillCustomerAndVehicle(scope)
      fireEvent.click(within(scope).getByRole("button", { name: "Book" }))
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Book appointment" })).not.toBeInTheDocument())
    }
    const keys = bookingRequests(api.requests).map((request) => request.headers.get("Idempotency-Key"))
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
  })

  it("follows the toast to a booking on another day and highlights it there", async () => {
    let booked: WorkshopScheduleResponse | null = null
    // Wednesday 2026-10-14, open 08:00-18:00 BST like Tuesday.
    const wednesday = {
      ...readingTuesday,
      date: "2026-10-14",
      operatingWindow: {
        startUtc: "2026-10-14T07:00:00Z",
        endUtc: "2026-10-14T17:00:00Z",
        opensAtLocal: "2026-10-14T08:00+01:00",
        closesAtLocal: "2026-10-14T18:00+01:00",
      },
    }
    mockBoardApi({
      schedule: (_, date) => (date === "2026-10-14" ? (booked ?? wednesday) : { ...readingTuesday, date }),
      availability: (_, __, date) => ({
        date,
        timeZoneId: "Europe/London",
        operatingWindow: readingTuesday.operatingWindow,
        durationMinutes: 60,
        slotGranularityMinutes: 15,
        slots: [
          {
            startUtc: `${date}T09:15:00Z`,
            endUtc: `${date}T10:15:00Z`,
            startLocal: `${date}T10:15+01:00`,
            freeBays: 4,
            freeTechnicians: 3,
          },
        ],
        unavailableReason: null,
      }),
      book: (_, body) => {
        const appointment = bookedFrom(body, { bay: bays.heavy })
        booked = {
          ...wednesday,
          bays: wednesday.bays.map((bay) => (bay.id === bays.heavy.id ? { ...bay, appointments: [scheduledFrom(appointment)] } : bay)),
        }
        return jsonResponse(appointment, { status: 201 })
      },
    })
    const { router } = renderBoard(readingBoard)
    const scope = await openDialog()

    fireEvent.click(within(scope).getByRole("button", { name: /^Date, / }))
    fireEvent.click(await screen.findByRole("button", { name: /October 14th, 2026/ }))
    await goToStepTwo(scope)
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    const toast = (await screen.findByText("Booked")).closest<HTMLElement>("[data-slot=toast]")!
    fireEvent.click(within(toast).getByRole("button", { name: "View on board" }))

    await waitFor(() => expect(search(router).date).toBe("2026-10-14"))
    const block = await screen.findByRole("button", { name: /^Interim Service, Bay 3 - Heavy duty, 10:15 to 11:15/ })
    expect(block).toHaveAttribute("data-booked")
  })
})

describe("booking an appointment on a phone", () => {
  beforeEach(() => phoneViewport())

  it("books in a full-screen sheet from the floating Book button and ends on the success state", async () => {
    let booked: WorkshopScheduleResponse | null = null
    mockBoardApi({
      schedule: () => booked ?? readingTuesday,
      book: (_, body) => {
        const appointment = bookedFrom(body, { bay: bays.heavy, technician: technicians.ben })
        booked = {
          ...readingTuesday,
          bays: readingTuesday.bays.map((bay) => (bay.id === bays.heavy.id ? { ...bay, appointments: [scheduledFrom(appointment)] } : bay)),
        }
        return appointment
      },
    })
    renderBoard(readingBoard)

    // The toolbar has no Book button on a phone: the floating action does the job.
    const fab = await screen.findByRole("button", { name: "Book appointment" })
    expect(fab).toHaveAttribute("data-slot", "book-fab")
    fireEvent.click(fab)
    const scope = await dialog()
    expect(scope).toHaveAttribute("data-side", "bottom")
    // Both step names stay visible on a phone.
    expect(within(scope).getByText("Service & time")).toBeInTheDocument()
    expect(within(scope).getByText("Customer & vehicle")).toBeInTheDocument()

    await goToStepTwo(scope)
    // The right keyboards: email, telephone, capitals for the VIN.
    expect(within(scope).getByRole("textbox", { name: "Email" })).toHaveAttribute("inputmode", "email")
    expect(within(scope).getByRole("textbox", { name: "Phone" })).toHaveAttribute("inputmode", "tel")
    expect(within(scope).getByRole("textbox", { name: "VIN" })).toHaveAttribute("autocapitalize", "characters")
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    expect(await within(scope).findByRole("heading", { level: 2, name: "Booked" })).toBeInTheDocument()
    expect(within(scope).getByText("Interim Service · Bay 3 - Heavy duty · Ben Okafor")).toBeInTheDocument()
    expect(within(scope).getByRole("button", { name: "Book another" })).toBeInTheDocument()
    expect(scope.querySelector('img[src*="booking-success"]')).toHaveAttribute("alt", "")

    fireEvent.click(within(scope).getByRole("button", { name: "View on board" }))

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Book appointment" })).not.toBeInTheDocument())
    const card = await screen.findByRole("button", { name: /^Interim Service, Bay 3 - Heavy duty, 10:15 to 11:15/ })
    expect(card).toHaveAttribute("data-booked")
  })
})
