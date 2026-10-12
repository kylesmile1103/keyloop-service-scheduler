import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { AvailabilityResponse, BookAppointmentRequest } from "@/api/types.gen"
import { featureSwitchesQueryKey } from "@/lib/feature-switches"
import { currentUserQueryKey } from "@/lib/session"
import { bookedFrom, mockBoardApi, requestsTo } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { admin, anonymous, viewer } from "@/test/identities"
import { jsonResponse, problemResponse } from "@/test/mock-api"
import { phoneViewport, pointerClick, renderBoard } from "@/test/render-board"
import { bays, interimAvailability, interimDetails, interimServiceType, technicians } from "@/test/schedules"
import { brakesServiceType } from "@/test/triage"
import {
  allocation,
  decodedVolkswagen,
  diagnosticsService,
  liveDiagnosisGap,
  profileConflict,
  readingTuesdayWithCompetence,
  vehicleAwareDisabled,
  vehicleAwareOff,
  vehicleAwareOn,
} from "@/test/vehicle"

// Task 31b: the booking dialog's vehicle step (ADR-029), with vehicle-aware requirements on, and today's flow with them off.

beforeAll(async () => {
  await import("@/app/dispatch/page")
})

beforeEach(() => {
  // Tuesday 2026-10-13, 09:30 in Reading (BST). Only Date is faked; timers stay real for the UI.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

const board = `/dispatch?dealership=${reading.id}`
const vin = "WVWZZZ1KZAW654321"
const reason = "Customer confirmed a diesel engine on the phone"

async function openDialog() {
  fireEvent.click(await screen.findByRole("button", { name: "Book appointment" }))
  return screen.findByRole("dialog", { name: "Book appointment" })
}

async function chooseService(scope: HTMLElement, name: RegExp) {
  fireEvent.click(await within(scope).findByRole("combobox", { name: "Service" }))
  pointerClick(await screen.findByRole("option", { name }))
}

async function choose(scope: HTMLElement, label: string, option: RegExp) {
  fireEvent.click(within(scope).getByRole("combobox", { name: label }))
  pointerClick(await screen.findByRole("option", { name: option }))
}

async function pickStart(scope: HTMLElement, name = /^10:15/) {
  const chip = await within(scope).findByRole("radio", { name })
  fireEvent.click(chip)
  await waitFor(() => expect(chip).toHaveAttribute("aria-checked", "true"))
}

async function next(scope: HTMLElement) {
  fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
  await within(scope).findByRole("heading", { name: "Customer and vehicle" })
}

function fillCustomer(scope: HTMLElement, overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    Name: "Grace Hopper",
    Email: "grace.hopper@example.com",
    Phone: "+44 7700 900123",
    VIN: vin,
    Registration: "RK22 ABC",
    Make: "Volkswagen",
    Model: "Golf",
    ...overrides,
  }
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(within(scope).getByRole("textbox", { name: label }), { target: { value } })
  }
}

const bookings = (requests: readonly Request[]) =>
  requests.filter((request) => request.method === "POST" && new URL(request.url).pathname.endsWith("/appointments"))
const resolves = (requests: readonly Request[]) => requests.filter((request) => new URL(request.url).pathname.endsWith("/vehicle-profiles/resolve"))
const bodyOf = async (request: Request) => (await request.clone().json()) as BookAppointmentRequest
const availabilityQueries = (requests: readonly Request[]) =>
  requestsTo(requests, "/availability").map((request) => Object.fromEntries(new URL(request.url).searchParams))

/** No identifier or private text in any address the app asked for (ADR-029, §8.7). */
function expectNothingPrivateInUrls(requests: readonly Request[], ...secrets: string[]) {
  for (const request of requests) {
    const url = decodeURIComponent(request.url).toUpperCase()
    for (const secret of secrets) expect(url).not.toContain(secret.toUpperCase())
  }
}

/** Interim Service's free starts for a vehicle: four starts for an ICE car, two for anything else (fewer qualify). */
const startsFor = (query: URLSearchParams): AvailabilityResponse =>
  query.get("powertrain") === "Ice"
    ? {
        ...interimAvailability,
        slots: [
          ...interimAvailability.slots,
          { startUtc: "2026-10-13T09:45:00Z", endUtc: "2026-10-13T10:45:00Z", startLocal: "2026-10-13T10:45+01:00", freeBays: 3, freeTechnicians: 2 },
          { startUtc: "2026-10-13T10:00:00Z", endUtc: "2026-10-13T11:00:00Z", startLocal: "2026-10-13T11:00+01:00", freeBays: 3, freeTechnicians: 2 },
        ],
      }
    : query.get("vehicleClass") === "Heavy"
      ? { ...interimAvailability, slots: [interimAvailability.slots[1]] }
      : interimAvailability

function vehicleApi(options: Parameters<typeof mockBoardApi>[0] = {}) {
  return mockBoardApi({
    features: () => vehicleAwareOn,
    me: () => admin,
    serviceTypes: () => [interimServiceType, brakesServiceType, diagnosticsService],
    schedule: () => readingTuesdayWithCompetence,
    ...options,
  })
}

describe("with vehicle-aware requirements off", () => {
  it("shows today's flow and sends no vehicle input, in availability or the booking", async () => {
    const api = mockBoardApi({ features: () => vehicleAwareOff, me: () => admin })
    renderBoard(board)
    const scope = await openDialog()

    await chooseService(scope, /^Interim Service/)
    await pickStart(scope)
    expect(within(scope).queryByRole("group", { name: "Vehicle" })).not.toBeInTheDocument()
    expect(within(scope).queryByText(/Counted for/)).not.toBeInTheDocument()
    await next(scope)
    expect(within(scope).queryByRole("button", { name: "Look up" })).not.toBeInTheDocument()
    fillCustomer(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))
    await screen.findByText("Booked")

    for (const query of availabilityQueries(api.requests)) {
      expect(Object.keys(query).sort()).toEqual(["date", "serviceTypeId"])
    }
    const body = await bodyOf(bookings(api.requests)[0])
    expect(body.vehicle).toEqual({ vin, registration: "RK22 ABC", make: "Volkswagen", model: "Golf" })
    expect(body).not.toHaveProperty("needsLiveDiagnosis")
    expect(resolves(api.requests)).toHaveLength(0)
  })
})

describe("the vehicle step, with vehicle-aware requirements on", () => {
  it("starts Unknown, planned as high-voltage, and counts the free starts for that vehicle", async () => {
    const api = vehicleApi()
    renderBoard(board)
    const scope = await openDialog()
    await chooseService(scope, /^Interim Service/)

    const vehicle = within(scope).getByRole("group", { name: "Vehicle" })
    expect(within(vehicle).getByRole("combobox", { name: "Powertrain" })).toHaveTextContent("Unknown")
    expect(within(vehicle).getByRole("combobox", { name: "Vehicle class" })).toHaveTextContent("Unknown")
    expect(within(vehicle).getByRole("combobox", { name: "Powertrain" })).toHaveAccessibleDescription(
      /planned as if the vehicle were high-voltage: only HV-trained technicians count/
    )
    expect(within(scope).getByText("Counted for a vehicle of unknown powertrain, planned as high-voltage.")).toBeInTheDocument()
    await pickStart(scope)
    expect(availabilityQueries(api.requests).at(-1)).toEqual({
      serviceTypeId: interimServiceType.id,
      date: "2026-10-13",
      powertrain: "Unknown",
      vehicleClass: "Unknown",
    })
  })

  it("asks a declared powertrain for a private reason, counted to 500, before going on", async () => {
    vehicleApi()
    renderBoard(board)
    const scope = await openDialog()
    await chooseService(scope, /^Interim Service/)
    await choose(scope, "Powertrain", /^Petrol or diesel/)
    await pickStart(scope)

    const reasonField = within(scope).getByRole("textbox", { name: "Why you’re declaring it" })
    expect(reasonField).toHaveAttribute("maxLength", "500")
    expect(reasonField).toHaveAccessibleDescription(/Kept with the booking for audit, never sent to the customer\. 0 of 500 characters/)
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))

    expect(await within(scope).findByText("Say why you're declaring the powertrain")).toBeInTheDocument()
    await waitFor(() => expect(reasonField).toHaveFocus())
    expect(reasonField).toHaveAttribute("aria-invalid", "true")
    expect(reasonField).toHaveAccessibleDescription(/^Say why you're declaring the powertrain/)

    fireEvent.change(reasonField, { target: { value: reason } })
    expect(within(scope).getByText(`${reason.length}/500`)).toBeInTheDocument()
    await next(scope)
  })

  it("names the change and the start that went when a heavy vehicle has fewer starts", async () => {
    const api = mockBoardApi({
      features: () => vehicleAwareOn,
      me: () => admin,
      serviceTypes: () => [interimServiceType],
      schedule: () => readingTuesdayWithCompetence,
      availability: () => interimAvailability,
    })
    // The heavy vehicle's starts: only 10:30.
    const route = api.fetchMock.getMockImplementation()!
    api.fetchMock.mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      if (url.pathname.endsWith("/availability")) {
        api.requests.push(request)
        return jsonResponse(startsFor(url.searchParams))
      }
      return route(input, init)
    })
    renderBoard(board)
    const scope = await openDialog()
    await chooseService(scope, /^Interim Service/)
    await pickStart(scope, /^10:15/)

    await choose(scope, "Vehicle class", /^Heavy vehicle/)

    const status = await within(scope).findByText(/^Updated for this vehicle: 1 start free, was 2\./)
    expect(status).toHaveTextContent("The start you chose, 10:15, isn’t free for it: choose another.")
    expect(status.closest("[role=status]")).not.toBeNull()
    await waitFor(() => expect(within(scope).queryByRole("radio", { checked: true })).not.toBeInTheDocument())
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    expect(await within(scope).findByText("Pick a start time")).toBeInTheDocument()

    // A car is back to the service's two; an ICE car has more: each count is measured against the last one shown.
    await choose(scope, "Vehicle class", /^Car/)
    expect(await within(scope).findByText(/^Updated for this vehicle: 2 starts free, was 1\./)).toBeInTheDocument()
    await choose(scope, "Powertrain", /^Petrol or diesel/)
    expect(await within(scope).findByText(/^Updated for this vehicle: 4 starts free, was 2\./)).toBeInTheDocument()
    expect(within(scope).getByText("Counted for a petrol or diesel car.")).toBeInTheDocument()
  })

  it("offers live HV diagnosis only where it applies, warns that it needs two people, and sends it", async () => {
    const api = vehicleApi()
    renderBoard(board)
    const scope = await openDialog()

    await chooseService(scope, /^Brake Pads & Discs/)
    expect(within(scope).queryByRole("switch", { name: "Needs live HV diagnosis" })).not.toBeInTheDocument()

    await chooseService(scope, /^Diagnostic Fault Finding/)
    const live = await within(scope).findByRole("switch", { name: "Needs live HV diagnosis" })
    expect(live).toHaveAccessibleDescription("Working on the high-voltage system while it is live: needs an HV level 4 technician and an EV bay.")
    fireEvent.click(live)
    expect(await within(scope).findByText(/Live working needs two trained people present/)).toBeInTheDocument()
    await waitFor(() => expect(availabilityQueries(api.requests).at(-1)).toMatchObject({ needsLiveDiagnosis: "true" }))

    // Not for a petrol or diesel vehicle: there is no high-voltage system to work on live.
    await choose(scope, "Powertrain", /^Petrol or diesel/)
    expect(within(scope).queryByRole("switch", { name: "Needs live HV diagnosis" })).not.toBeInTheDocument()
    await waitFor(() => expect(availabilityQueries(api.requests).at(-1)).not.toHaveProperty("needsLiveDiagnosis"))
  })

  it("looks the VIN up when it is left whole, in the request body only, and shows the manufacturer from the VIN", async () => {
    const api = vehicleApi()
    renderBoard(board)
    const scope = await openDialog()
    await chooseService(scope, /^Interim Service/)
    await choose(scope, "Powertrain", /^Battery electric/)
    fireEvent.change(within(scope).getByRole("textbox", { name: "Why you’re declaring it" }), { target: { value: reason } })
    await pickStart(scope)
    await next(scope)

    expect(within(scope).getByText("Look up the VIN to read it.")).toBeInTheDocument()
    const vinField = within(scope).getByRole("textbox", { name: "VIN" })
    fireEvent.change(vinField, { target: { value: vin.toLowerCase() } })
    fireEvent.blur(vinField)

    expect(await within(scope).findByText("VOLKSWAGEN")).toBeInTheDocument()
    const facts = within(scope).getByText("VOLKSWAGEN").closest<HTMLElement>("[data-slot=vehicle-facts]")!
    expect(within(facts).getByText("from VIN")).toBeInTheDocument()
    expect(facts).toHaveTextContent("A VIN doesn’t record the powertrain or the class: they stay as declared on step 1.")
    // A recognised VIN decides the manufacturer: nothing to declare.
    expect(within(scope).queryByRole("textbox", { name: "Manufacturer code (optional)" })).not.toBeInTheDocument()
    // The summary shows the vehicle as declared, each fact with where it came from.
    expect(within(scope).getByText("Battery electric").parentElement).toHaveTextContent("Battery electric, declared")
    expect(within(scope).getByText("Class not known")).toBeInTheDocument()

    const [lookUp] = resolves(api.requests)
    expect(lookUp.method).toBe("POST")
    expect(await lookUp.clone().json()).toEqual({ vin })
    expect(new URL(lookUp.url).search).toBe("")

    // Leaving the field again does not ask again; the button does.
    fireEvent.blur(vinField)
    fireEvent.click(within(scope).getByRole("button", { name: "Look up" }))
    await waitFor(() => expect(resolves(api.requests)).toHaveLength(2))

    fillCustomer(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))
    await screen.findByText("Booked")
    const body = await bodyOf(bookings(api.requests)[0])
    // What was declared, never what the look-up answered: no provenance, no decoded manufacturer copied back.
    expect(body.vehicle.profile).toEqual({ powertrain: "BatteryElectric", vehicleClass: "Unknown", declarationReason: reason })
    expectNothingPrivateInUrls(api.requests, vin, reason, "RK22")
    expect(availabilityQueries(api.requests).some((query) => query.manufacturer === "VOLKSWAGEN")).toBe(false)
  })

  it("lets a VIN the API does not know have a declared manufacturer code, which availability then uses", async () => {
    const api = vehicleApi()
    renderBoard(board)
    const scope = await openDialog()
    await chooseService(scope, /^Interim Service/)
    await pickStart(scope)
    await next(scope)
    fillCustomer(scope, { VIN: "SALGA2EV5HA123456" })
    fireEvent.click(within(scope).getByRole("button", { name: "Look up" }))

    expect(await within(scope).findByText("Not recognised from the VIN")).toBeInTheDocument()
    fireEvent.change(within(scope).getByRole("textbox", { name: "Manufacturer code (optional)" }), { target: { value: "land-rover" } })
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))
    await screen.findByText("Booked")

    expect((await bodyOf(bookings(api.requests)[0])).vehicle.profile).toEqual({
      powertrain: "Unknown",
      vehicleClass: "Unknown",
      manufacturer: "LAND-ROVER",
    })
  })
})

describe("a declared manufacturer the VIN contradicts", () => {
  async function declareBmwWithVolkswagenVin(api: ReturnType<typeof vehicleApi>) {
    renderBoard(board)
    const scope = await openDialog()
    await chooseService(scope, /^Interim Service/)
    await pickStart(scope)
    await next(scope)
    fillCustomer(scope)
    fireEvent.change(within(scope).getByRole("textbox", { name: "Manufacturer code (optional)" }), { target: { value: "bmw" } })
    return { scope, api }
  }

  it("is caught before Book once the VIN is looked up, and Use decoded data books with the VIN's data", async () => {
    const api = vehicleApi()
    const { scope } = await declareBmwWithVolkswagenVin(api)
    fireEvent.click(within(scope).getByRole("button", { name: "Look up" }))

    expect(await within(scope).findByText("The VIN says VOLKSWAGEN, but BMW is declared. The VIN is the stronger evidence.")).toBeInTheDocument()
    expect(within(scope).getByRole("textbox", { name: "Manufacturer code (optional)" })).toHaveAccessibleDescription(/The VIN says VOLKSWAGEN/)
    fireEvent.click(within(scope).getByRole("button", { name: "Use decoded data" }))
    expect(within(scope).getByText("Booking uses VOLKSWAGEN from the VIN; the declared BMW is set aside.")).toBeInTheDocument()

    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))
    await screen.findByText("Booked")
    expect((await bodyOf(bookings(api.requests)[0])).vehicle.profile).toEqual({
      powertrain: "Unknown",
      vehicleClass: "Unknown",
      manufacturer: "BMW",
      conflictChoice: "UseDecoded",
    })
  })

  it("answered 422 by the API: says what disagrees, takes focus, and Use decoded data sends the same booking with UseDecoded", async () => {
    let attempts = 0
    const api = vehicleApi({
      book: (_, body) => (++attempts === 1 ? problemResponse(422, profileConflict) : bookedFrom(body)),
    })
    const { scope } = await declareBmwWithVolkswagenVin(api)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    const alert = await within(scope).findByRole("alert")
    expect(alert).toHaveTextContent("The declared vehicle doesn’t match its VIN")
    expect(alert).toHaveTextContent("Manufacturer: declared BMW, the VIN says otherwise.")
    await waitFor(() => expect(alert).toHaveFocus())
    fireEvent.click(within(alert).getByRole("button", { name: "Use decoded data" }))
    await screen.findByText("Booked")

    const [first, second] = bookings(api.requests)
    expect((await bodyOf(first)).vehicle.profile).not.toHaveProperty("conflictChoice")
    expect((await bodyOf(second)).vehicle.profile).toMatchObject({ manufacturer: "BMW", conflictChoice: "UseDecoded" })
    expect(second.headers.get("Idempotency-Key")).toBe(first.headers.get("Idempotency-Key"))
  })

  it("Edit the declaration puts focus on the manufacturer the advisor declared", async () => {
    const api = vehicleApi({ book: () => problemResponse(422, profileConflict) })
    const { scope } = await declareBmwWithVolkswagenVin(api)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))
    const alert = await within(scope).findByRole("alert")

    fireEvent.click(within(alert).getByRole("button", { name: "Edit the declaration" }))

    await waitFor(() => expect(within(scope).getByRole("textbox", { name: "Manufacturer code (optional)" })).toHaveFocus())
    expect(within(scope).queryByRole("alert")).not.toBeInTheDocument()
  })
})

describe("a competence gap", () => {
  it("names the HV level and the rules in plain words, as the workshop's gap rather than an error (live diagnosis at Reading)", async () => {
    const api = vehicleApi({ book: () => problemResponse(422, liveDiagnosisGap) })
    renderBoard(board)
    const scope = await openDialog()
    await chooseService(scope, /^Diagnostic Fault Finding/)
    fireEvent.click(await within(scope).findByRole("switch", { name: "Needs live HV diagnosis" }))
    await pickStart(scope)
    await next(scope)
    fillCustomer(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    const alert = await within(scope).findByRole("alert")
    expect(alert).toHaveAttribute("data-tone", "info")
    expect(alert).toHaveTextContent("No technician here is trained for live HV work yet")
    expect(alert).toHaveTextContent("This job needsHV 4Live working")
    expect(alert).toHaveTextContent("routine work happens alongside high-voltage cabling")
    expect(alert).toHaveTextContent("live working on the high-voltage system needs level 4 and an EV bay")
    expect(alert).toHaveTextContent(
      "No active technician at Keyloop Motors Reading has all of that on the day. That is a gap in the workshop’s training or equipment, not a fault in this booking."
    )
    expect(alert).toHaveTextContent("turn off live HV diagnosis and choose a start again")
    expect(alert).not.toHaveTextContent(/error|failed/i)
    expect((await bodyOf(bookings(api.requests)[0])).needsLiveDiagnosis).toBe(true)

    fireEvent.click(within(alert).getByRole("button", { name: "Change the vehicle details" }))
    await waitFor(() => expect(within(scope).getByRole("group", { name: "Vehicle" })).toHaveFocus())
  })

  it("says what the vehicle adds when no bay and technician qualify for the day's starts", async () => {
    vehicleApi({ availability: () => ({ ...interimAvailability, slots: [], unavailableReason: "no-qualified-resources" }) })
    renderBoard(board)
    const scope = await openDialog()
    await chooseService(scope, /^Diagnostic Fault Finding/)
    fireEvent.click(await within(scope).findByRole("switch", { name: "Needs live HV diagnosis" }))

    expect(await within(scope).findByRole("heading", { name: "No qualified bay and technician for Diagnostic Fault Finding" })).toBeInTheDocument()
    expect(
      within(scope).getByText("It needs an HV level 4 technician and an EV bay, for live working on the high-voltage system.")
    ).toBeInTheDocument()
    expect(within(scope).getByText(/That is a gap in the workshop’s training or equipment, not a fault in this booking\./)).toBeInTheDocument()
  })
})

describe("a server that takes no vehicle-aware input now (422 vehicle-aware-requirements-disabled)", () => {
  it("from Book: drops the vehicle inputs, reads the switch again past the HTTP cache, and Book again sends today's body", async () => {
    let switchedOff = false
    const api = vehicleApi({
      features: () => (switchedOff ? vehicleAwareOff : vehicleAwareOn),
      book: (_, body) => {
        if (body.vehicle.profile || body.needsLiveDiagnosis) {
          switchedOff = true
          return problemResponse(422, vehicleAwareDisabled(["vehicle.profile"]))
        }
        return bookedFrom(body)
      },
    })
    renderBoard(board)
    const scope = await openDialog()
    await chooseService(scope, /^Interim Service/)
    await choose(scope, "Powertrain", /^Petrol or diesel/)
    fireEvent.change(within(scope).getByRole("textbox", { name: "Why you’re declaring it" }), { target: { value: reason } })
    await pickStart(scope)
    await next(scope)
    fillCustomer(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    const alert = await within(scope).findByRole("alert")
    expect(alert).toHaveTextContent("Vehicle details aren’t used here now")
    expect(alert).toHaveTextContent("the powertrain, class and live-diagnosis choice were dropped")
    await waitFor(() => expect(within(scope).queryByRole("button", { name: "Look up" })).not.toBeInTheDocument())
    const switchReads = requestsTo(api.requests, "/features")
    expect(switchReads.at(-1)!.cache).toBe("reload")

    fireEvent.click(within(alert).getByRole("button", { name: "Book again" }))
    await screen.findByText("Booked")
    const second = await bodyOf(bookings(api.requests)[1])
    expect(second.vehicle).toEqual({ vin, registration: "RK22 ABC", make: "Volkswagen", model: "Golf" })
  })

  it("from availability: says so on step 1 and reads the starts again without the vehicle", async () => {
    // The API was restarted with the switch off after the app read it: it now says off.
    let switchedOff = false
    const api = vehicleApi({
      features: () => (switchedOff ? vehicleAwareOff : vehicleAwareOn),
      availability: () => interimAvailability,
    })
    const route = api.fetchMock.getMockImplementation()!
    api.fetchMock.mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      if (url.pathname.endsWith("/availability") && url.searchParams.has("powertrain")) {
        api.requests.push(request)
        switchedOff = true
        return problemResponse(422, vehicleAwareDisabled(["powertrain", "vehicleClass"]))
      }
      return route(input, init)
    })
    renderBoard(board)
    const scope = await openDialog()
    await chooseService(scope, /^Interim Service/)

    expect(await within(scope).findByText("Vehicle details aren’t used here now")).toBeInTheDocument()
    expect(within(scope).queryByRole("group", { name: "Vehicle" })).not.toBeInTheDocument()
    // The starts are the service's standard ones (the board's own read of them): no vehicle parameter is sent again.
    await pickStart(scope)
    expect(availabilityQueries(api.requests).filter((query) => "powertrain" in query)).toHaveLength(1)
    expect(requestsTo(api.requests, "/features").at(-1)!.cache).toBe("reload")
  })
})

describe("the switch turning off while a declaration is entered (a later read, after an API restart)", () => {
  it("drops the declaration, says so on step 1 and counts the starts without the vehicle", async () => {
    const api = vehicleApi()
    const { queryClient } = renderBoard(board)
    const scope = await openDialog()
    await chooseService(scope, /^Interim Service/)
    await choose(scope, "Powertrain", /^Petrol or diesel/)
    fireEvent.change(within(scope).getByRole("textbox", { name: "Why you’re declaring it" }), { target: { value: reason } })

    act(() => queryClient.setQueryData(featureSwitchesQueryKey(), vehicleAwareOff))

    expect(await within(scope).findByText("Vehicle details aren’t used here now")).toBeInTheDocument()
    expect(within(scope).queryByRole("group", { name: "Vehicle" })).not.toBeInTheDocument()
    expect(scope).not.toHaveTextContent(reason)
    await pickStart(scope)
    await next(scope)
    fillCustomer(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))
    await screen.findByText("Booked")
    expect((await bodyOf(bookings(api.requests)[0])).vehicle).not.toHaveProperty("profile")
  })
})

describe("the look-up, for an account that cannot book", () => {
  it.each([
    { who: "signed out", me: anonymous, reason: /you’re signed out/ },
    { who: "a Viewer", me: viewer, reason: /this account can’t book any more/ },
  ])("is unavailable once the account is $who, named by the session note, and sends nothing", async ({ me, reason: why }) => {
    let identity = admin
    const api = vehicleApi({ me: () => identity })
    const { queryClient } = renderBoard(board)
    const scope = await openDialog()
    identity = me
    act(() => queryClient.setQueryData(currentUserQueryKey(), me))
    await within(scope).findByText(why)

    await chooseService(scope, /^Interim Service/)
    await pickStart(scope)
    await next(scope)
    const lookUp = within(scope).getByRole("button", { name: "Look up" })
    expect(lookUp).toHaveAttribute("aria-disabled", "true")
    expect(lookUp).toHaveAccessibleDescription(why)
    const vinField = within(scope).getByRole("textbox", { name: "VIN" })
    fireEvent.change(vinField, { target: { value: vin } })
    fireEvent.blur(vinField)
    fireEvent.click(lookUp)
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(resolves(api.requests)).toHaveLength(0)
  })
})

describe("the vehicle step is part of the booking being entered", () => {
  it("is discarded with it when the caller signs out: the reason, the VIN and what the look-up said", async () => {
    let identity = admin
    vehicleApi({ me: () => identity })
    const { queryClient } = renderBoard(board)
    const scope = await openDialog()
    await chooseService(scope, /^Interim Service/)
    await choose(scope, "Powertrain", /^Petrol or diesel/)
    fireEvent.change(within(scope).getByRole("textbox", { name: "Why you’re declaring it" }), { target: { value: reason } })
    await pickStart(scope)
    await next(scope)
    fillCustomer(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Look up" }))
    await within(scope).findByText("VOLKSWAGEN")

    identity = anonymous
    act(() => queryClient.setQueryData(currentUserQueryKey(), anonymous))

    await within(scope).findByText(/The booking you were entering was discarded/)
    expect(scope).not.toHaveTextContent(reason)
    expect(scope).not.toHaveTextContent("VOLKSWAGEN")
    expect(scope).not.toHaveTextContent(/Petrol or diesel/)
    for (const field of within(scope).queryAllByRole("textbox")) expect((field as HTMLInputElement).value).not.toContain(reason)
    const cache = JSON.stringify({
      queries: queryClient.getQueryCache().getAll().map((query) => query.state.data),
      mutations: queryClient.getMutationCache().getAll().map((mutation) => mutation.state),
    })
    expect(cache).not.toContain(vin)
    expect(cache).not.toContain(reason)
  })

  it("keeps a look-up only for the caller it was made as", async () => {
    let identity = admin
    vehicleApi({ me: () => identity })
    const { queryClient } = renderBoard(board)
    const scope = await openDialog()
    await chooseService(scope, /^Interim Service/)
    await pickStart(scope)
    await next(scope)
    fillCustomer(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Look up" }))
    await within(scope).findByText("VOLKSWAGEN")

    // The same email in another role that may book keeps the booking being entered, but the look-up is read again.
    identity = { ...admin, roles: ["ServiceAdvisor"] }
    act(() => queryClient.setQueryData(currentUserQueryKey(), identity))

    await waitFor(() => expect(within(scope).queryByText("VOLKSWAGEN")).not.toBeInTheDocument())
    expect((within(scope).getByRole("textbox", { name: "VIN" }) as HTMLInputElement).value).toBe(vin)
    expect(within(scope).getByText("Look up the VIN to read it.")).toBeInTheDocument()
  })
})

describe("the allocation, explained after booking", () => {
  const explainedBooking = (body: BookAppointmentRequest) => ({
    ...bookedFrom(body, { bay: bays.standard, technician: technicians.amelia }),
    vehicle: { ...bookedFrom(body).vehicle, profile: { ...decodedVolkswagen, powertrain: "BatteryElectric" as const, provenance: { ...decodedVolkswagen.provenance, powertrain: "Declared" as const } } },
    allocation: allocation({
      decidedBy: "OnlyQualifiedResource",
      minimumHvLevel: 2,
      firedRules: ["hv-routine"],
      reasons: ["preferred-technician:minimum-hv-level"],
      preferredTechnicianId: technicians.farid.id,
    }),
  })

  it("says why this technician, and why not the one asked for, in the toast", async () => {
    vehicleApi({ book: (_, body) => explainedBooking(body) })
    renderBoard(board)
    const scope = await openDialog()
    await chooseService(scope, /^Interim Service/)
    await choose(scope, "Powertrain", /^Battery electric/)
    fireEvent.change(within(scope).getByRole("textbox", { name: "Why you’re declaring it" }), { target: { value: reason } })
    await pickStart(scope)
    await next(scope)
    fillCustomer(scope)
    await choose(scope, "Preferred technician", /^Farid Haddad/)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    const toast = (await screen.findByText("Booked")).closest<HTMLElement>("[data-slot=toast]")!
    expect(toast).toHaveTextContent(
      "Amelia Clarke: the only free technician at HV level 2 or above with General service, for a battery-electric vehicle (declared)."
    )
    expect(toast).toHaveTextContent("Farid Haddad holds HV level 1, below the level 2 this job needs.")
  })

  it("shows the explanation in the phone's booked state", async () => {
    phoneViewport()
    vehicleApi({ book: (_, body) => explainedBooking(body) })
    renderBoard(board)
    fireEvent.click(await screen.findByRole("button", { name: "Book appointment" }))
    const scope = await screen.findByRole("dialog", { name: "Book appointment" })
    await chooseService(scope, /^Interim Service/)
    await pickStart(scope)
    await next(scope)
    fillCustomer(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    const why = await within(scope).findByRole("region", { name: "Why this allocation" })
    expect(why).toHaveTextContent("Amelia Clarke: the only free technician at HV level 2 or above with General service")
    expect(why).toHaveTextContent("Not as you asked")
    expect(why).toHaveTextContent("Farid Haddad holds HV level 1, below the level 2 this job needs.")
  })
})

describe("the allocation, explained in the details sheet", () => {
  const interimLabel = "Interim Service, Bay 1 - Standard, 08:00 to 09:00, Amelia Clarke, Confirmed"
  const explainedRecord = {
    ...interimDetails,
    vehicle: {
      vin: "JTDKN3DU0A0123460",
      registration: "RF20 BCJ",
      make: "Toyota",
      model: "Prius",
      profile: {
        powertrain: "FullHybrid" as const,
        manufacturer: "TOYOTA",
        vehicleClass: "Car" as const,
        provenance: {
          powertrain: "Declared" as const,
          manufacturer: "VinDecoded" as const,
          vehicleClass: "Declared" as const,
          // The audit actor, as the API records it.
          declaredBy: "user:advisor@keyloop.test",
          declarationReason: "Hybrid badge on the tailgate",
        },
      },
    },
    allocation: allocation({
      decidedBy: "PreferredResource",
      bayDecidedBy: "OnlyQualifiedResource",
      minimumHvLevel: 2,
      firedRules: ["hv-routine"],
      reasons: ["preferred-bay:busy"],
      preferredBayId: bays.alignment.id,
      preferredTechnicianId: technicians.amelia.id,
    }),
  }

  it("says why this technician and bay, why not the bay asked for, and the vehicle as declared, for a role", async () => {
    vehicleApi({ appointment: () => explainedRecord })
    renderBoard(board)
    fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })

    const why = await within(sheet).findByRole("region", { name: "Why this allocation" })
    expect(why).toHaveTextContent(
      "Amelia Clarke: the technician you asked for, free and qualified at HV level 2 or above with General service, for a full hybrid (declared)."
    )
    expect(why).toHaveTextContent("Bay 1 - Standard: the only free bay that fits the job.")
    expect(why).toHaveTextContent("routine work happens alongside high-voltage cabling")
    expect(why).toHaveTextContent("Bay 2 - Alignment was busy at that time.")
    expect(why).toHaveTextContent("Declared by advisor@keyloop.test: “Hybrid badge on the tailgate”")
    expect(within(why).getByText("TOYOTA").parentElement).toHaveTextContent("TOYOTA, from VIN")
  })

  it("shows none with vehicle-aware requirements off", async () => {
    vehicleApi({ features: () => vehicleAwareOff, appointment: () => explainedRecord })
    renderBoard(board)
    fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    await within(sheet).findByRole("link", { name: "sophie.turner@example.com" })

    expect(within(sheet).queryByRole("region", { name: "Why this allocation" })).not.toBeInTheDocument()
  })

  it("shows none to a visitor, whose sheet reads no record", async () => {
    const api = vehicleApi({ me: () => anonymous, appointment: () => explainedRecord })
    renderBoard(board)
    fireEvent.click(await screen.findByRole("button", { name: /^Interim Service, Bay 1 - Standard, 08:00 to 09:00/ }))
    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    await within(sheet).findByText("Sign in to see the whole booking")

    expect(within(sheet).queryByRole("region", { name: "Why this allocation" })).not.toBeInTheDocument()
    expect(sheet).not.toHaveTextContent("Hybrid badge")
    expect(requestsTo(api.requests, `/appointments/${explainedRecord.id}`)).toHaveLength(0)
  })
})
