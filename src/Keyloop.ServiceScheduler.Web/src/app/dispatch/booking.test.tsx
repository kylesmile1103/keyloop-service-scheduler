import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { BookAppointmentRequest, WorkshopScheduleResponse } from "@/api/types.gen"
import { formatDay } from "@/lib/calendar-date"
import * as telemetry from "@/lib/telemetry"
import { bookedFrom, mockBoardApi, requestsTo, scheduledFrom } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { expectAvailable, expectUnavailableButFocusable } from "@/test/focus"
import { matchesWidth } from "@/test/media-query"
import { jsonResponse, problemResponse } from "@/test/mock-api"
import { phoneViewport, pointerClick, renderBoard, search, viewportOf } from "@/test/render-board"
import { bays, interimAvailability, interimServiceType, readingTuesday, technicians } from "@/test/schedules"
import { triageEnabled } from "@/test/triage"
import { vehicleAwareOn } from "@/test/vehicle"

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
    const availabilityReads = requestsTo(api.requests, "/availability").length
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
    // The day's free starts are read again too: the slot is gone from the next free slot and from the chips.
    await waitFor(() => expect(requestsTo(api.requests, "/availability").length).toBeGreaterThan(availabilityReads))
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

  // Today is Tuesday 13 October; Reading is closed on Sundays.
  it.each([
    { board: "the board's open day", date: "2026-10-14", starts: "Wednesday 14 October 2026" },
    { board: "the next open day after a closed one", date: "2026-10-18", starts: "Monday 19 October 2026" },
    { board: "today instead of a past day", date: "2026-10-12", starts: "Tuesday 13 October 2026" },
  ])("starts on $board", async ({ date, starts }) => {
    mockBoardApi()
    renderBoard(`${readingBoard}&date=${date}`)
    await screen.findByRole("button", { name: `Choose date, ${formatDay(date, "long")}` })

    const scope = await openDialog()

    expect(within(scope).getByRole("button", { name: /^Date, / })).toHaveAccessibleName(`Date, ${starts}`)
  })

  it("names a need once when the bay's equipment and the technician's certification share its name", async () => {
    mockBoardApi({ serviceTypes: () => [interimServiceType, diagnosticsServiceType] })
    renderBoard(readingBoard)
    const scope = await openDialog()

    fireEvent.click(within(scope).getByRole("combobox", { name: "Service" }))
    const option = await screen.findByRole("option", { name: /^Diagnostic Fault Finding/ })

    expect(within(option).getAllByText("Diagnostics")).toHaveLength(1)
    expect(within(option).getByText("Needs: Diagnostics.")).toBeInTheDocument()
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
    const availabilityReads = requestsTo(api.requests, "/availability").length
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    const alert = await within(scope).findByRole("alert")
    expect(alert).toHaveAttribute("data-tone", "warning")
    expect(within(alert).getByText("Slot just taken - pick another time")).toBeInTheDocument()
    // The free starts the dialog and the board showed are stale: they are read again.
    await waitFor(() => expect(requestsTo(api.requests, "/availability").length).toBeGreaterThan(availabilityReads))
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

  it("names the field by its label when the API's message starts with its JSON path", async () => {
    // The API's own wording (BookAppointmentValidator), which names each field by its path in the request body.
    mockBoardApi({
      book: () =>
        problemResponse(400, {
          type: `${problems}validation-error`,
          title: "Validation failed",
          status: 400,
          detail: "One or more fields are invalid.",
          traceId: "00-2bf7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
          errors: {
            "customer.email": ["customer.email must be an email address of at most 254 characters."],
            "vehicle.vin": ["vehicle.vin must be a 17-character VIN of digits and letters other than I, O and Q."],
            "customer.name": ["customer.name is required, at most 120 characters."],
          },
        }),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await goToStepTwo(scope)
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    expect(await within(scope).findByText("Email must be an email address of at most 254 characters.")).toBeInTheDocument()
    expect(within(scope).getByText("VIN must be a 17-character VIN of digits and letters other than I, O and Q.")).toBeInTheDocument()
    expect(within(scope).getByText("Name is required, at most 120 characters.")).toBeInTheDocument()
    expect(within(scope).queryByText(/customer\.|vehicle\./)).not.toBeInTheDocument()
  })

  it("returns to the first step when the API refuses the start time as malformed", async () => {
    mockBoardApi({
      book: () =>
        problemResponse(400, {
          type: `${problems}validation-error`,
          title: "Validation failed",
          status: 400,
          detail: "One or more fields are invalid.",
          traceId: "00-3af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
          errors: { startUtc: ["Start must be a UTC instant."] },
        }),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await goToStepTwo(scope)
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    expect(await within(scope).findByRole("heading", { name: "Service and time" })).toBeInTheDocument()
    expect(within(scope).getByText("Start must be a UTC instant.")).toBeInTheDocument()
    expect(within(scope).getByRole("radiogroup", { name: "Start time" })).toHaveAttribute("aria-invalid", "true")
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
    // Book waits too, and stays focusable meanwhile: it was just pressed, and keyboard focus must not fall out of the dialog.
    expectUnavailableButFocusable(within(scope).getByRole("button", { name: /^Book \(in \d s\)$/ }))
  })

  it("keeps keyboard focus on Book while it books and after a refusal, and sends nothing on a second press", async () => {
    let answer: () => void = () => {}
    const held = new Promise<void>((resolve) => (answer = resolve))
    const api = mockBoardApi({ book: async () => (await held, problemResponse(409, slotUnavailable)) })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await goToStepTwo(scope)
    fillCustomerAndVehicle(scope)
    const book = within(scope).getByRole("button", { name: "Book" })

    book.focus()
    fireEvent.click(book)

    await waitFor(() => expect(book).toHaveAccessibleName("Booking…"))
    expect(book).toHaveFocus()
    expectUnavailableButFocusable(book)
    fireEvent.click(book)
    expect(bookingRequests(api.requests)).toHaveLength(1)

    answer()
    await within(scope).findByRole("alert")
    expect(book).toHaveAccessibleName("Book")
    expect(book).toHaveFocus()
    expectAvailable(book)
  })

  it("keeps the failure and keyboard focus on Try again while the free times are looked up again", async () => {
    let answer: () => void = () => {}
    let held: Promise<void> | null = null
    const api = mockBoardApi({
      availability: async () => {
        await held
        return problemResponse(503, { title: "Service unavailable", status: 503, detail: "The availability service is unavailable." })
      },
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    fireEvent.click(within(scope).getByRole("combobox", { name: "Service" }))
    pointerClick(await screen.findByRole("option", { name: /^Interim Service/ }))

    const alert = (await within(scope).findByText("Couldn’t look up free times")).closest<HTMLElement>('[role="alert"]')!
    const tryAgain = within(alert).getByRole("button", { name: "Try again" })
    const reads = () => requestsTo(api.requests, "/availability").length
    const before = reads()
    held = new Promise<void>((resolve) => (answer = resolve))
    tryAgain.focus()
    fireEvent.click(tryAgain)

    await waitFor(() => expect(reads()).toBe(before + 1))
    // The free times' failure stays while they are looked up again, so focus stays in the dialog, on Try again.
    expect(tryAgain).toBeInTheDocument()
    expectUnavailableButFocusable(tryAgain)
    expect(tryAgain).toHaveFocus()
    expect(within(scope).queryByText("Looking for free start times…")).not.toBeInTheDocument()
    fireEvent.click(tryAgain)

    answer()
    await waitFor(() => expectAvailable(tryAgain))
    expect(tryAgain).toHaveFocus()
    expect(reads()).toBe(before + 1)
  })

  it("keeps the failure and keyboard focus on Try again while the services are loaded again", async () => {
    let answer: () => void = () => {}
    let held: Promise<void> | null = null
    const api = mockBoardApi({
      serviceTypes: async () => {
        await held
        return problemResponse(503, { title: "Service unavailable", status: 503, detail: "The catalogue service is unavailable." })
      },
    })
    renderBoard(readingBoard)
    const scope = await openDialog()

    const alert = (await within(scope).findByText("Couldn’t load the services")).closest<HTMLElement>('[role="alert"]')!
    const tryAgain = within(alert).getByRole("button", { name: "Try again" })
    expectAvailable(tryAgain)
    const reads = () => requestsTo(api.requests, "/service-types").length
    const before = reads()
    held = new Promise<void>((resolve) => (answer = resolve))
    tryAgain.focus()
    fireEvent.click(tryAgain)

    await waitFor(() => expect(reads()).toBe(before + 1))
    expect(tryAgain).toBeInTheDocument()
    expectUnavailableButFocusable(tryAgain)
    expect(tryAgain).toHaveFocus()
    fireEvent.click(tryAgain)

    answer()
    await waitFor(() => expectAvailable(tryAgain))
    expect(tryAgain).toHaveFocus()
    expect(reads()).toBe(before + 1)
  })

  it("keeps the failure and keyboard focus on Try again while the booking is sent again, and sends nothing on a second press", async () => {
    let answer: () => void = () => {}
    let held: Promise<void> | null = null
    const api = mockBoardApi({
      book: async () => {
        await held
        return new Response("", { status: 503, statusText: "Service Unavailable" })
      },
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await goToStepTwo(scope)
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    const alert = await within(scope).findByRole("alert")
    const tryAgain = within(alert).getByRole("button", { name: "Try again" })
    held = new Promise<void>((resolve) => (answer = resolve))
    tryAgain.focus()
    fireEvent.click(tryAgain)

    await within(scope).findByRole("button", { name: "Booking…" })
    expect(bookingRequests(api.requests)).toHaveLength(2)
    // The failure stays while the same booking is sent again, so focus stays in the dialog, on Try again.
    expect(alert).toBeInTheDocument()
    expect(tryAgain).toBeInTheDocument()
    expectUnavailableButFocusable(tryAgain)
    expect(tryAgain).toHaveFocus()
    fireEvent.click(tryAgain)

    answer()
    await waitFor(() => expectAvailable(tryAgain))
    expect(tryAgain).toHaveFocus()
    expect(within(scope).getByRole("button", { name: "Book" })).toBeInTheDocument()
    const [, second, ...more] = bookingRequests(api.requests)
    expect(more).toHaveLength(0)
    expect(second.headers.get("Idempotency-Key")).toBe(bookingRequests(api.requests)[0].headers.get("Idempotency-Key"))
  })

  it("keeps keyboard focus on a suggested start while it books, and moves it to the new refusal when that start is taken too", async () => {
    const takenAgain = {
      ...slotUnavailable,
      detail: "Every qualified bay or technician is busy at 10:30.",
      traceId: "00-7e1b4c8d9e0f1a2b5d2c3f0a3c4d5e6f-2b3c4d5e6f7a8b1a-01",
      suggestedSlots: [
        { startUtc: "2026-10-13T10:00:00Z", endUtc: "2026-10-13T11:00:00Z", startLocal: "2026-10-13T11:00+01:00" },
        { startUtc: "2026-10-13T10:30:00Z", endUtc: "2026-10-13T11:30:00Z", startLocal: "2026-10-13T11:30+01:00" },
      ],
    }
    let answer: () => void = () => {}
    let held: Promise<void> | null = null
    let attempts = 0
    const api = mockBoardApi({
      book: async () => {
        if (++attempts === 1) return problemResponse(409, slotUnavailable)
        await held
        return problemResponse(409, takenAgain)
      },
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await goToStepTwo(scope)
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    const alert = await within(scope).findByRole("alert")
    const chip = within(alert).getByRole("button", { name: "Book at 10:30 instead" })
    held = new Promise<void>((resolve) => (answer = resolve))
    chip.focus()
    fireEvent.click(chip)

    await within(scope).findByRole("button", { name: "Booking…" })
    expect(bookingRequests(api.requests)).toHaveLength(2)
    // The refusal and its starts stay while the picked one is booked: focus stays on it, and it says what it is doing.
    expect(chip).toBeInTheDocument()
    expectUnavailableButFocusable(chip)
    expect(chip).toHaveFocus()
    expect(chip).toHaveAttribute("aria-busy", "true")
    expect(within(chip).getByText("Booking…")).toBeInTheDocument()
    expectUnavailableButFocusable(within(alert).getByRole("button", { name: "Book at 11:00 instead" }))
    expect(within(alert).getByRole("button", { name: "Choose another time" })).toBeDisabled()
    fireEvent.click(chip)
    fireEvent.click(within(alert).getByRole("button", { name: "Book at 11:00 instead" }))

    answer()
    // 10:30 went too: its chip leaves with the old refusal, and focus moves to the new one instead of the dialog.
    expect(await within(scope).findByText(takenAgain.detail)).toBeInTheDocument()
    expect(chip).not.toBeInTheDocument()
    const refusal = within(scope).getByRole("alert")
    expect(refusal).toHaveFocus()
    expectAvailable(within(refusal).getByRole("button", { name: "Book at 11:30 instead" }))
    expect(bookingRequests(api.requests)).toHaveLength(2)
  })

  it("keeps keyboard focus on a suggested start that the next refusal offers again", async () => {
    let answer: () => void = () => {}
    let held: Promise<void> | null = null
    let attempts = 0
    const api = mockBoardApi({
      book: async () => {
        if (++attempts > 1) await held
        return problemResponse(409, slotUnavailable)
      },
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await goToStepTwo(scope)
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    const chip = within(await within(scope).findByRole("alert")).getByRole("button", { name: "Book at 10:30 instead" })
    held = new Promise<void>((resolve) => (answer = resolve))
    chip.focus()
    fireEvent.click(chip)
    await within(scope).findByRole("button", { name: "Booking…" })

    answer()
    await waitFor(() => expectAvailable(chip))
    expect(chip).toHaveFocus()
    expect(within(chip).getByText("Book this time")).toBeInTheDocument()
    expect(bookingRequests(api.requests)).toHaveLength(2)
  })

  it("moves keyboard focus to the field the API refused when the pressed start leaves with the old refusal", async () => {
    let attempts = 0
    mockBoardApi({
      book: () =>
        ++attempts === 1
          ? problemResponse(409, slotUnavailable)
          : problemResponse(400, {
              type: `${problems}validation-error`,
              title: "Validation failed",
              status: 400,
              detail: "One or more fields are invalid.",
              traceId: "00-2af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
              errors: { "vehicle.vin": ["VIN check digit is wrong."] },
            }),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await goToStepTwo(scope)
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    const chip = within(await within(scope).findByRole("alert")).getByRole("button", { name: "Book at 10:30 instead" })
    chip.focus()
    fireEvent.click(chip)

    expect(await within(scope).findByText("VIN check digit is wrong.")).toBeInTheDocument()
    // Every message sits under its field, so the refusal above the form goes, and the chip with it.
    expect(within(scope).queryByText("Slot just taken - pick another time")).not.toBeInTheDocument()
    expect(chip).not.toBeInTheDocument()
    expect(within(scope).getByRole("textbox", { name: "VIN" })).toHaveFocus()
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

  it("groups the free starts into morning and afternoon, with noon in the afternoon", async () => {
    const at = (local: string) => {
      const startUtc = new Date(Date.parse(`2026-10-13T${local}:00+01:00`)).toISOString().replace(".000Z", "Z")
      return { startUtc, endUtc: startUtc, startLocal: `2026-10-13T${local}+01:00`, freeBays: 1, freeTechnicians: 1 }
    }
    mockBoardApi({ availability: () => ({ ...interimAvailability, slots: [at("11:45"), at("12:00"), at("12:15")] }) })
    renderBoard(readingBoard)
    const scope = await openDialog()
    fireEvent.click(within(scope).getByRole("combobox", { name: "Service" }))
    pointerClick(await screen.findByRole("option", { name: /^Interim Service/ }))
    await within(scope).findByRole("radio", { name: /^12:00/ })

    const group = (name: string) => within(scope).getByText(name).parentElement!
    expect(within(group("Morning")).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label")?.slice(0, 5))).toEqual(["11:45"])
    expect(within(group("Afternoon")).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label")?.slice(0, 5))).toEqual([
      "12:00",
      "12:15",
    ])
  })

  it("lets the booked halo go after about 3 seconds", async () => {
    // Timers are fake here so the 3 s can pass at once; they still advance with real time, for the UI's own waits.
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true })
    vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
    let booked: WorkshopScheduleResponse | null = null
    mockBoardApi({
      schedule: () => booked ?? readingTuesday,
      book: (_, body) => {
        const appointment = bookedFrom(body, { bay: bays.heavy })
        booked = {
          ...readingTuesday,
          bays: readingTuesday.bays.map((bay) => (bay.id === bays.heavy.id ? { ...bay, appointments: [scheduledFrom(appointment)] } : bay)),
        }
        return appointment
      },
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await goToStepTwo(scope)
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    const block = await screen.findByRole("button", { name: /^Interim Service, Bay 3 - Heavy duty, 10:15 to 11:15/ })
    await waitFor(() => expect(block).toHaveAttribute("data-booked"))
    await act(() => vi.advanceTimersByTimeAsync(2500))
    expect(block).toHaveAttribute("data-booked")
    await act(() => vi.advanceTimersByTimeAsync(700))
    expect(block).not.toHaveAttribute("data-booked")
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
    const book = within(scope).getByRole("button", { name: "Book" })
    book.focus()
    fireEvent.click(book)

    expect(await within(scope).findByRole("heading", { level: 2, name: "Booked" })).toBeInTheDocument()
    // Book left with the form: its next step takes focus, so it does not fall to the sheet.
    expect(within(scope).getByRole("button", { name: "View on board" })).toHaveFocus()
    expect(within(scope).getByText("Interim Service · Bay 3 - Heavy duty · Ben Okafor")).toBeInTheDocument()
    expect(within(scope).getByRole("button", { name: "Book another" })).toBeInTheDocument()
    expect(scope.querySelector('img[src*="booking-success"]')).toHaveAttribute("alt", "")

    fireEvent.click(within(scope).getByRole("button", { name: "View on board" }))

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Book appointment" })).not.toBeInTheDocument())
    const card = await screen.findByRole("button", { name: /^Interim Service, Bay 3 - Heavy duty, 10:15 to 11:15/ })
    expect(card).toHaveAttribute("data-booked")
  })

  it("books another in the same sheet with a new idempotency key", async () => {
    const api = mockBoardApi()
    renderBoard(readingBoard)
    fireEvent.click(await screen.findByRole("button", { name: "Book appointment" }))
    const scope = await dialog()

    for (let round = 0; round < 2; round++) {
      await goToStepTwo(scope)
      fillCustomerAndVehicle(scope)
      fireEvent.click(within(scope).getByRole("button", { name: "Book" }))
      await within(scope).findByRole("heading", { level: 2, name: "Booked" })
      if (round === 0) fireEvent.click(within(scope).getByRole("button", { name: "Book another" }))
    }

    // A second booking with the first one's key would be refused as idempotency-key-reuse (or replayed).
    const keys = bookingRequests(api.requests).map((request) => request.headers.get("Idempotency-Key"))
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
  })
})

// Task 33: from 1280 px the dialog is about 1100 px wide, step 1 puts the job beside its start times and step 2 the customer
// beside the vehicle; narrower, and on a phone, it is one column as before. jsdom draws no layout: the columns are seen
// through their names, what each holds, the reading (and so Tab) order and the dialog's width class.
describe("the booking dialog's two columns", () => {
  /** The order the step's fields come in, which is the order Tab takes through them. */
  const fieldOrder = (scope: HTMLElement) =>
    within(scope)
      .getAllByRole("textbox")
      .concat(within(scope).getAllByRole("combobox"))
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      .map((field) => field.getAttribute("aria-label") ?? (field as HTMLInputElement | HTMLButtonElement).labels?.[0]?.textContent ?? field.id)

  const before = (first: Element, second: Element) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)

  const stepTwoOrder = ["Name", "Email", "Phone", "VIN", "Registration", "Make", "Model", "Preferred bay", "Preferred technician", "Notes for the workshop"]

  it("puts the job on the left and its start times on the right from 1280 px, in reading order", async () => {
    mockBoardApi()
    renderBoard(readingBoard)
    const scope = await openDialog()
    expect(scope).toHaveClass("sm:max-w-[68.75rem]")

    // Without the vehicle step the left column holds the service and the day.
    const job = within(scope).getByRole("group", { name: "Service and date" })
    const times = within(scope).getByRole("group", { name: "Start time" })
    expect(within(job).getByRole("heading", { name: "Service and time" })).toBeInTheDocument()
    expect(within(job).getByRole("combobox", { name: "Service" })).toBeInTheDocument()
    expect(within(job).getByRole("button", { name: /^Date, / })).toBeInTheDocument()
    expect(within(times).getByText("Choose a service to see its free start times.")).toBeInTheDocument()

    await chooseInterimAt1015(scope)
    const grid = within(times).getByRole("radiogroup", { name: "Start time" })
    expect(within(grid).getByRole("radio", { name: "10:15, 4 bays and 3 technicians free" })).toBeChecked()
    // Left column top to bottom, then the right one, then the footer.
    expect(before(job, times)).toBe(true)
    expect(before(within(job).getByRole("button", { name: /^Date, / }), grid)).toBe(true)
    expect(before(grid, within(scope).getByRole("button", { name: "Next" }))).toBe(true)

    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    await within(scope).findByRole("heading", { name: "Customer and vehicle" })
    // The customer beside the vehicle, the fields in the order they always had.
    expect(fieldOrder(scope)).toEqual(stepTwoOrder)
    expect(within(scope).queryByRole("group", { name: "Start time" })).not.toBeInTheDocument()
  })

  it("keeps the triage block and the vehicle step in the left column", async () => {
    mockBoardApi({ triageStatus: () => triageEnabled, features: () => vehicleAwareOn })
    renderBoard(readingBoard)
    const scope = await openDialog()

    const job = await within(scope).findByRole("group", { name: "Service and vehicle" })
    expect(await within(job).findByRole("textbox", { name: "Describe the issue" })).toBeInTheDocument()
    expect(within(job).getByRole("group", { name: "Vehicle" })).toBeInTheDocument()
    expect(within(job).getByRole("combobox", { name: "Powertrain" })).toBeInTheDocument()

    fireEvent.click(within(scope).getByRole("combobox", { name: "Service" }))
    pointerClick(await screen.findByRole("option", { name: /^Interim Service/ }))
    const times = within(scope).getByRole("group", { name: "Start time" })
    expect(await within(times).findByRole("radiogroup", { name: "Start time" })).toBeInTheDocument()
    // The note on what the starts are counted for sits with them.
    expect(within(times).getByText(/^Counted for a vehicle of unknown powertrain/)).toBeInTheDocument()
  })

  it.each([
    { viewport: "a 1024 px tablet", width: 1024 },
    { viewport: "a 390 px phone", width: 390 },
  ])("stays one column on $viewport", async ({ width }) => {
    viewportOf(width)
    mockBoardApi()
    renderBoard(readingBoard)
    fireEvent.click(await screen.findByRole("button", { name: "Book appointment" }))
    const scope = await dialog()
    if (width >= 768) {
      expect(scope).toHaveClass("sm:max-w-2xl")
      expect(scope).not.toHaveClass("sm:max-w-[68.75rem]")
    } else expect(scope).toHaveAttribute("data-side", "bottom")

    await chooseInterimAt1015(scope)
    expect(within(scope).queryByRole("group", { name: /^Service and/ })).not.toBeInTheDocument()
    expect(within(scope).queryByRole("group", { name: "Start time" })).not.toBeInTheDocument()
    expect(within(scope).getByRole("radiogroup", { name: "Start time" })).toBeInTheDocument()

    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    await within(scope).findByRole("heading", { name: "Customer and vehicle" })
    expect(fieldOrder(scope)).toEqual(stepTwoOrder)
  })

  it("keeps the chosen start and its focus when the window crosses 1280 px", async () => {
    // A viewport whose width can change, telling the breakpoint hooks as a browser would.
    let width = 1440
    const listeners = new Set<() => void>()
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
      matches: matchesWidth(query, width),
      media: query,
      onchange: null,
      addEventListener: (_: string, listener: EventListenerOrEventListenerObject) => listeners.add(listener as () => void),
      removeEventListener: (_: string, listener: EventListenerOrEventListenerObject) => listeners.delete(listener as () => void),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }))
    const resize = (to: number) => {
      width = to
      act(() => listeners.forEach((listener) => listener()))
    }
    mockBoardApi()
    renderBoard(readingBoard)
    const scope = await openDialog()
    await chooseInterimAt1015(scope)
    const chip = within(scope).getByRole("radio", { name: "10:15, 4 bays and 3 technicians free" })
    chip.focus()

    resize(1024)
    expect(within(scope).queryByRole("group", { name: "Start time" })).not.toBeInTheDocument()
    expect(scope).toHaveClass("sm:max-w-2xl")
    // The same chip, still chosen and focused: nothing was mounted again.
    expect(within(scope).getByRole("radio", { name: "10:15, 4 bays and 3 technicians free" })).toBe(chip)
    expect(chip).toBeChecked()
    expect(chip).toHaveFocus()

    resize(1440)
    expect(within(within(scope).getByRole("group", { name: "Start time" })).getByRole("radio", { checked: true })).toBe(chip)
    expect(chip).toHaveFocus()
  })
})
