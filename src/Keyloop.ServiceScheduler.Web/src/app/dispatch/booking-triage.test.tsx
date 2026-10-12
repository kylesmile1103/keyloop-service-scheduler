import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { getBookingTriageStatusQueryKey } from "@/api/@tanstack/react-query.gen"
import type { BookAppointmentRequest, TriageBookingRequest } from "@/api/types.gen"
import * as telemetry from "@/lib/telemetry"
import { mockBoardApi, requestsTo } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { expectAvailable, expectUnavailableButFocusable } from "@/test/focus"
import { problemResponse } from "@/test/mock-api"
import { phoneViewport, pointerClick, renderBoard } from "@/test/render-board"
import { availabilityOn, interimServiceType } from "@/test/schedules"
import {
  askedFor,
  brakesServiceType,
  diagnosticsServiceType,
  triageAnswer,
  triageDisabled,
  triageEnabled,
  triageUnavailable,
} from "@/test/triage"

// Booking intake triage (Task 26): describe the issue, get suggested services from the catalogue, and use one in step 1.

vi.mock("@/lib/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/telemetry")>()
  return { ...actual, withSpan: vi.fn(actual.withSpan) }
})

beforeAll(async () => {
  await import("@/app/dispatch/page")
})

const readingBoard = `/dispatch?dealership=${reading.id}`
const problems = "https://api.keyloop.example/problems/"
const catalogue = () => [interimServiceType, brakesServiceType, diagnosticsServiceType]
const disclosure = "Suggestions by Clef-flash via Cloudflare AI Gateway. Check before booking."

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

const describeIssue = (scope: HTMLElement) => within(scope).findByRole("textbox", { name: "Describe the issue" })

async function describeAndSuggest(scope: HTMLElement, text = "Brakes squeal, it's an EV, need it Thursday") {
  fireEvent.change(await describeIssue(scope), { target: { value: text } })
  fireEvent.click(within(scope).getByRole("button", { name: "Suggest a service" }))
}

const triageRequests = (requests: readonly Request[]) =>
  requests.filter((request) => request.method === "POST" && new URL(request.url).pathname.endsWith("/booking-triage"))
const bookingRequests = (requests: readonly Request[]) =>
  requests.filter((request) => request.method === "POST" && new URL(request.url).pathname.endsWith("/appointments"))
const availabilityReads = (requests: readonly Request[]) =>
  requestsTo(requests, "/availability").map((request) => Object.fromEntries(new URL(request.url).searchParams))

/** Step 1's manual path: Interim Service from the select, then its 10:15 chip. */
async function chooseInterimAt1015(scope: HTMLElement) {
  fireEvent.click(within(scope).getByRole("combobox", { name: "Service" }))
  pointerClick(await screen.findByRole("option", { name: /^Interim Service/ }))
  const chip = await within(scope).findByRole("radio", { name: "10:15, 4 bays and 3 technicians free" })
  fireEvent.click(chip)
  await waitFor(() => expect(chip).toHaveAttribute("aria-checked", "true"))
}

function fillCustomerAndVehicle(scope: HTMLElement) {
  const values: Record<string, string> = {
    Name: "Grace Hopper",
    Email: "grace.hopper@example.com",
    Phone: "+44 7700 900123",
    VIN: "WVWZZZ1KZAW654321",
    Registration: "RK22 ABC",
    Make: "Volkswagen",
    Model: "Golf",
  }
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(within(scope).getByRole("textbox", { name: label }), { target: { value } })
  }
}

describe("suggesting a service from the issue", () => {
  it("suggests a service from the description, and applies it with the day asked for only when the person uses it", async () => {
    const api = mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      triage: () => triageAnswer("suggest", [[brakesServiceType, 0.85], [diagnosticsServiceType, 0.1]], askedFor("2026-10-15")),
    })
    const consoleError = vi.spyOn(console, "error")
    renderBoard(readingBoard)
    const scope = await openDialog()

    const description = await describeIssue(scope)
    expect(within(scope).getByText(disclosure)).toBeInTheDocument()
    const typed = "  Brakes squeal, it's an EV, need it Thursday  "
    fireEvent.change(description, { target: { value: typed } })
    // A live count against the status's limit.
    expect(within(scope).getByText(`${typed.length}/500`)).toBeInTheDocument()
    fireEvent.click(within(scope).getByRole("button", { name: "Suggest a service" }))

    const likely = await within(scope).findByRole("radio", { name: /^Brake Pads & Discs/ })
    // The description is sent trimmed, for this dealership.
    const [request] = triageRequests(api.requests)
    expect(new URL(request.url).pathname).toBe(`/api/v1/dealerships/${reading.id}/booking-triage`)
    expect((await request.clone().json()) as TriageBookingRequest).toEqual({ description: "Brakes squeal, it's an EV, need it Thursday" })

    // The likely service is chosen in the list, with its duration, its needs from the catalogue and its likelihood.
    expect(likely).toHaveAccessibleName("Brake Pads & Discs, 90 min, Likely 85%")
    expect(likely).toHaveAccessibleDescription("Needs: Brakes.")
    expect(likely).toHaveAttribute("aria-checked", "true")
    const possible = within(scope).getByRole("radio", { name: /^Diagnostic Fault Finding/ })
    expect(possible).toHaveAccessibleName("Diagnostic Fault Finding, 60 min, Possible 10%")
    expect(possible).toHaveAttribute("aria-checked", "false")
    expect(within(scope).getByRole("radiogroup", { name: "Suggested services" })).toBeInTheDocument()
    expect(within(scope).getByText("Thu 15 Oct")).toBeInTheDocument()
    // A screen reader hears what came back.
    expect(within(scope).getByText("Likely: Brake Pads & Discs, 85%. Asked for Thursday 15 October. Check it, then choose Use this.")).toHaveAttribute(
      "role",
      "status"
    )

    // Nothing is applied until the person uses it.
    expect(within(scope).getByRole("combobox", { name: "Service" })).toHaveTextContent("Choose a service")
    expect(availabilityReads(api.requests).filter((query) => query.serviceTypeId === brakesServiceType.id)).toHaveLength(0)

    fireEvent.click(within(scope).getByRole("button", { name: "Use this" }))

    // The service and the day are applied, the free starts are read for them, and focus goes to the first one.
    await waitFor(() => expect(within(scope).getByRole("combobox", { name: "Service" })).toHaveTextContent("Brake Pads & Discs"))
    expect(within(scope).getByRole("button", { name: /^Date, / })).toHaveAccessibleName("Date, Thursday 15 October 2026")
    const chip = await within(scope).findByRole("radio", { name: /^10:15/ })
    await waitFor(() => expect(chip).toHaveFocus())
    expect(availabilityReads(api.requests)).toContainEqual({ serviceTypeId: brakesServiceType.id, date: "2026-10-15" })
    // The suggestion now says it is in use.
    expectUnavailableButFocusable(within(scope).getByRole("button", { name: "In use" }))

    // The browser span names the dealership and never the description.
    expect(telemetry.withSpan).toHaveBeenCalledWith("ui.booking_triage", expect.any(Function), { "keyloop.dealership_id": reading.id })
    const spans = vi.mocked(telemetry.withSpan).mock.calls.map(([name, , attributes]) => [name, attributes])
    expect(JSON.stringify(spans)).not.toMatch(/squeal/i)
    expect(consoleError).not.toHaveBeenCalled()
  })

  it("asks the person to choose when several services could fit, and preselects none", async () => {
    const api = mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      triage: () => triageAnswer("confirm", [[diagnosticsServiceType, 0.45], [brakesServiceType, 0.4]]),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "Strange noise and a warning light")

    const first = await within(scope).findByRole("radio", { name: /^Diagnostic Fault Finding/ })
    const second = within(scope).getByRole("radio", { name: /^Brake Pads & Discs/ })
    expect(first).toHaveAccessibleName("Diagnostic Fault Finding, 60 min, Possible 45%")
    expect(second).toHaveAccessibleName("Brake Pads & Discs, 90 min, Possible 40%")
    expect(first).toHaveAttribute("aria-checked", "false")
    expect(second).toHaveAttribute("aria-checked", "false")
    expect(within(scope).getByText("These services could fit. Choose the one that matches, then use it.")).toBeInTheDocument()
    expect(within(scope).getByText("2 services could fit: Diagnostic Fault Finding, Brake Pads & Discs. Choose one, then choose Use this.")).toHaveAttribute(
      "role",
      "status"
    )
    // Nothing chosen, nothing to use yet.
    const use = within(scope).getByRole("button", { name: "Use this" })
    expectUnavailableButFocusable(use)

    fireEvent.click(first)
    await waitFor(() => expect(first).toHaveAttribute("aria-checked", "true"))
    expectAvailable(use)
    fireEvent.click(use)

    // No day was asked for, so the day stays the board's.
    await waitFor(() => expect(within(scope).getByRole("combobox", { name: "Service" })).toHaveTextContent("Diagnostic Fault Finding"))
    expect(within(scope).getByRole("button", { name: /^Date, / })).toHaveAccessibleName("Date, Tuesday 13 October 2026")
    await waitFor(() => expect(within(scope).getByRole("radio", { name: /^10:15/ })).toHaveFocus())
    expect(availabilityReads(api.requests)).toContainEqual({ serviceTypeId: diagnosticsServiceType.id, date: "2026-10-13" })

    // Choosing another service by hand makes the suggestion usable again.
    fireEvent.click(within(scope).getByRole("combobox", { name: "Service" }))
    pointerClick(await screen.findByRole("option", { name: /^Interim Service/ }))
    await waitFor(() => expectAvailable(within(scope).getByRole("button", { name: "Use this" })))
  })

  it("says plainly when no service matches, and leaves the service to the person", async () => {
    mockBoardApi({ triageStatus: () => triageEnabled, serviceTypes: catalogue, triage: () => triageAnswer("no-match", []) })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "Can you deliver a pizza?")

    expect(await within(scope).findByText("No service here matches the description. Choose the service yourself below.")).toBeInTheDocument()
    expect(within(scope).queryByRole("radiogroup", { name: "Suggested services" })).not.toBeInTheDocument()
    expect(within(scope).queryByRole("button", { name: "Use this" })).not.toBeInTheDocument()

    await chooseInterimAt1015(scope)
  })

  it("explains a closed day it was asked for, and leaves the date as it is", async () => {
    const api = mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      // Reading is closed on Sundays.
      triage: () => triageAnswer("suggest", [[brakesServiceType, 0.9]], askedFor("2026-10-18")),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "Brakes grinding, can you do Sunday?")

    expect(await within(scope).findByText("Sun 18 Oct")).toBeInTheDocument()
    expect(within(scope).getByText("The workshop is closed on Sundays, so the date is not changed.")).toBeInTheDocument()
    expect(
      within(scope).getByText("Likely: Brake Pads & Discs, 90%. Asked for Sunday 18 October, when the workshop is closed. Check it, then choose Use this.")
    ).toHaveAttribute("role", "status")
    fireEvent.click(within(scope).getByRole("button", { name: "Use this" }))

    await waitFor(() => expect(within(scope).getByRole("combobox", { name: "Service" })).toHaveTextContent("Brake Pads & Discs"))
    expect(within(scope).getByRole("button", { name: /^Date, / })).toHaveAccessibleName("Date, Tuesday 13 October 2026")
    await waitFor(() => expect(availabilityReads(api.requests)).toContainEqual({ serviceTypeId: brakesServiceType.id, date: "2026-10-13" }))
  })

  it("says a day asked for that has already passed is not applied, without calling the workshop closed then", async () => {
    const api = mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      // Monday, when Reading opens, but the day before today: an answer for a description sent just before midnight.
      triage: () => triageAnswer("suggest", [[brakesServiceType, 0.9]], askedFor("2026-10-12")),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "Brakes grinding, can you do Monday?")

    expect(await within(scope).findByText("Mon 12 Oct")).toBeInTheDocument()
    expect(within(scope).getByText("That day has passed, so the date is not changed.")).toBeInTheDocument()
    expect(within(scope).queryByText(/workshop is closed/)).not.toBeInTheDocument()
    expect(
      within(scope).getByText("Likely: Brake Pads & Discs, 90%. Asked for Monday 12 October, which has passed. Check it, then choose Use this.")
    ).toHaveAttribute("role", "status")
    fireEvent.click(within(scope).getByRole("button", { name: "Use this" }))

    await waitFor(() => expect(within(scope).getByRole("combobox", { name: "Service" })).toHaveTextContent("Brake Pads & Discs"))
    expect(within(scope).getByRole("button", { name: /^Date, / })).toHaveAccessibleName("Date, Tuesday 13 October 2026")
    await waitFor(() => expect(availabilityReads(api.requests)).toContainEqual({ serviceTypeId: brakesServiceType.id, date: "2026-10-13" }))
  })

  it("drops a start chosen by hand when a suggestion is used, so a start for the new service and day is chosen again", async () => {
    mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      // Each day's free starts are its own: Tuesday's 10:15 is not among Thursday's chips.
      availability: (_, __, date) => availabilityOn(date),
      triage: () => triageAnswer("suggest", [[brakesServiceType, 0.85]], askedFor("2026-10-15")),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await chooseInterimAt1015(scope)
    await describeAndSuggest(scope)
    fireEvent.click(await within(scope).findByRole("button", { name: "Use this" }))

    await waitFor(() => expect(within(scope).getByRole("combobox", { name: "Service" })).toHaveTextContent("Brake Pads & Discs"))
    expect(within(scope).getByRole("button", { name: /^Date, / })).toHaveAccessibleName("Date, Thursday 15 October 2026")
    const starts = await within(scope).findByRole("radiogroup", { name: "Start time" })
    await waitFor(() => expect(within(starts).getByRole("radio", { name: /^10:15/ })).toHaveFocus())
    for (const chip of within(starts).getAllByRole("radio")) expect(chip).toHaveAttribute("aria-checked", "false")

    // Nothing carries Tuesday's Interim start on to step 2: Next asks for a start instead.
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    expect(await within(scope).findByText("Pick a start time")).toBeInTheDocument()
    expect(within(scope).getByRole("heading", { name: "Service and time" })).toBeInTheDocument()
    expect(within(scope).queryByRole("heading", { name: "Customer and vehicle" })).not.toBeInTheDocument()
  })

  it("shows the shared problem alert when suggestions are unavailable, and booking by hand still works", async () => {
    const api = mockBoardApi({ triageStatus: () => triageEnabled, serviceTypes: catalogue })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope)

    const alert = await within(scope).findByRole("alert")
    expect(alert).toHaveAttribute("data-tone", "error")
    expect(within(alert).getByText("Couldn’t suggest a service")).toBeInTheDocument()
    expect(within(alert).getByText(triageUnavailable.detail)).toBeInTheDocument()
    expect(within(alert).getByText(triageUnavailable.traceId)).toBeInTheDocument()

    // Try again sends the same description.
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(triageRequests(api.requests)).toHaveLength(2))
    const [first, second] = triageRequests(api.requests)
    expect(await second.clone().json()).toEqual(await first.clone().json())

    await chooseInterimAt1015(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    expect(await within(scope).findByRole("heading", { name: "Customer and vehicle" })).toBeInTheDocument()
  })

  it.each([
    { reason: "suggestions are off", triageStatus: () => triageDisabled },
    {
      reason: "their status cannot be read",
      triageStatus: () => problemResponse(500, { title: "Internal Server Error", status: 500, detail: "The status read failed." }),
    },
  ])("leaves the whole section out when $reason", async ({ triageStatus }) => {
    const api = mockBoardApi({ triageStatus, serviceTypes: catalogue })
    const { queryClient } = renderBoard(readingBoard)
    const scope = await openDialog()
    await within(scope).findByRole("combobox", { name: "Service" })

    await waitFor(() => expect(queryClient.getQueryState(getBookingTriageStatusQueryKey())?.status).toMatch(/^(success|error)$/))
    expect(within(scope).queryByRole("textbox", { name: "Describe the issue" })).not.toBeInTheDocument()
    expect(within(scope).queryByText(disclosure)).not.toBeInTheDocument()
    expect(within(scope).queryByRole("button", { name: "Suggest a service" })).not.toBeInTheDocument()
    expect(triageRequests(api.requests)).toHaveLength(0)
    await chooseInterimAt1015(scope)
  })

  it("asks for a description before it suggests anything", async () => {
    const api = mockBoardApi({ triageStatus: () => triageEnabled, serviceTypes: catalogue })
    renderBoard(readingBoard)
    const scope = await openDialog()
    const description = await describeIssue(scope)
    fireEvent.change(description, { target: { value: "   " } })

    fireEvent.click(within(scope).getByRole("button", { name: "Suggest a service" }))

    expect(await within(scope).findByText("Describe the issue to get a suggestion.")).toBeInTheDocument()
    expect(description).toHaveAttribute("aria-invalid", "true")
    expect(description).toHaveFocus()
    expect(triageRequests(api.requests)).toHaveLength(0)
  })

  it("limits the description to the status's maximum", async () => {
    mockBoardApi({ triageStatus: () => ({ ...triageEnabled, maxDescriptionLength: 40 }), serviceTypes: catalogue })
    renderBoard(readingBoard)
    const scope = await openDialog()
    const description = await describeIssue(scope)

    expect(description).toHaveAttribute("maxlength", "40")
    expect(within(scope).getByText("0/40")).toBeInTheDocument()
    fireEvent.change(description, { target: { value: "Brakes squeal" } })
    expect(within(scope).getByText("13/40")).toBeInTheDocument()
  })

  it("puts the API's description error under the field", async () => {
    mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      triage: () =>
        problemResponse(400, {
          type: `${problems}validation-error`,
          title: "Validation failed",
          status: 400,
          detail: "One or more fields are invalid.",
          traceId: "00-5af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
          errors: { description: ["description must be 1 to 500 characters after trimming."] },
        }),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope)

    expect(await within(scope).findByText("Description must be 1 to 500 characters after trimming.")).toBeInTheDocument()
    expect(within(scope).getByRole("textbox", { name: "Describe the issue" })).toHaveAttribute("aria-invalid", "true")
  })

  it("waits out a rate limit before it suggests again", async () => {
    mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      triage: () =>
        problemResponse(429, {
          type: `${problems}rate-limited`,
          title: "Too many requests",
          status: 429,
          detail: "Too many requests from this client.",
          traceId: "00-6af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
          retryAfterSeconds: 5,
        }),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope)

    const alert = await within(scope).findByRole("alert")
    expect(alert).toHaveAttribute("data-tone", "info")
    expect(within(alert).getByText(/^Too many requests - try again in \d s$/)).toBeInTheDocument()
    expectUnavailableButFocusable(within(scope).getByRole("button", { name: /^Suggest a service \(in \d s\)$/ }))
  })

  it("keeps keyboard focus on Suggest a service while it asks, and sends nothing on a second press", async () => {
    let answer: () => void = () => {}
    const held = new Promise<void>((resolve) => (answer = resolve))
    const api = mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      triage: async () => (await held, triageAnswer("suggest", [[brakesServiceType, 0.85]])),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    fireEvent.change(await describeIssue(scope), { target: { value: "Brakes squeal" } })
    const suggest = within(scope).getByRole("button", { name: "Suggest a service" })

    suggest.focus()
    fireEvent.click(suggest)

    await waitFor(() => expect(suggest).toHaveAccessibleName("Suggesting…"))
    expect(suggest).toHaveFocus()
    expectUnavailableButFocusable(suggest)
    fireEvent.click(suggest)
    expect(triageRequests(api.requests)).toHaveLength(1)

    answer()
    await within(scope).findByRole("radio", { name: /^Brake Pads & Discs/ })
    expect(suggest).toHaveAccessibleName("Suggest a service")
    expect(suggest).toHaveFocus()
    expectAvailable(suggest)
  })

  it("keeps keyboard focus on Try again while it asks again, then puts it on Suggest a service when the answer comes", async () => {
    let answer: () => void = () => {}
    let held: Promise<void> | null = null
    let attempts = 0
    const api = mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      triage: async () => {
        if (++attempts === 1) return problemResponse(503, triageUnavailable)
        await held
        return triageAnswer("suggest", [[brakesServiceType, 0.85]])
      },
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope)

    const alert = await within(scope).findByRole("alert")
    const tryAgain = within(alert).getByRole("button", { name: "Try again" })
    held = new Promise<void>((resolve) => (answer = resolve))
    tryAgain.focus()
    fireEvent.click(tryAgain)

    await waitFor(() => expect(triageRequests(api.requests)).toHaveLength(2))
    // The failure stays while the same description is sent again, so focus stays in the dialog, on Try again.
    expect(tryAgain).toBeInTheDocument()
    expectUnavailableButFocusable(tryAgain)
    expect(tryAgain).toHaveFocus()
    fireEvent.click(tryAgain)

    answer()
    await within(scope).findByRole("radio", { name: /^Brake Pads & Discs/ })
    // Try again went with the alert: focus is back on the action that asks, not lost to the dialog.
    expect(alert).not.toBeInTheDocument()
    expect(within(scope).getByRole("button", { name: "Suggest a service" })).toHaveFocus()
    expect(triageRequests(api.requests)).toHaveLength(2)
  })

  it("says when the description has changed since the suggestions", async () => {
    mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      triage: () => triageAnswer("suggest", [[brakesServiceType, 0.85]]),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope)
    await within(scope).findByRole("radio", { name: /^Brake Pads & Discs/ })

    fireEvent.change(within(scope).getByRole("textbox", { name: "Describe the issue" }), { target: { value: "Aircon is not cold" } })

    expect(within(scope).getByText("The description or photos have changed since these suggestions. Suggest again to update them.")).toBeInTheDocument()
  })

  it("offers a service the dealership cannot book only as information", async () => {
    mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: () => [interimServiceType, { ...brakesServiceType, bookable: false }],
      triage: () => triageAnswer("suggest", [[brakesServiceType, 0.85]]),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope)

    const card = await within(scope).findByRole("radio", { name: /^Brake Pads & Discs/ })
    expect(card).toHaveAttribute("aria-disabled", "true")
    expect(card).toHaveAccessibleDescription("Not offered here: no qualified bay or technician")
    expectUnavailableButFocusable(within(scope).getByRole("button", { name: "Use this" }))
  })
})

describe("copying the description into Notes", () => {
  it("copies the description into Notes and keeps it up to date, never over notes the person wrote", async () => {
    mockBoardApi({ triageStatus: () => triageEnabled, serviceTypes: catalogue })
    renderBoard(readingBoard)
    const scope = await openDialog()
    const description = await describeIssue(scope)
    fireEvent.change(description, { target: { value: "  Brakes squeal on the motorway  " } })
    expect(within(scope).getByRole("checkbox", { name: "Copy the description into Notes" })).toBeChecked()

    await chooseInterimAt1015(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    const notes = await within(scope).findByRole("textbox", { name: "Notes for the workshop" })
    expect(notes).toHaveValue("Brakes squeal on the motorway")
    // Step 2 says where the notes came from, and that they are kept with the booking.
    expect(notes).toHaveAccessibleDescription("Copied from the description of the issue. Notes are saved with the booking.")

    // Changed on step 1 while the notes are still the copy: the copy follows.
    fireEvent.click(within(scope).getByRole("button", { name: "Back" }))
    fireEvent.change(await describeIssue(scope), { target: { value: "Brakes grind when cold" } })
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    expect(await within(scope).findByRole("textbox", { name: "Notes for the workshop" })).toHaveValue("Brakes grind when cold")

    // Unticked: the copy goes again.
    fireEvent.click(within(scope).getByRole("button", { name: "Back" }))
    fireEvent.click(within(scope).getByRole("checkbox", { name: "Copy the description into Notes" }))
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    expect(await within(scope).findByRole("textbox", { name: "Notes for the workshop" })).toHaveValue("")

    // The person's own notes are never replaced.
    fireEvent.change(within(scope).getByRole("textbox", { name: "Notes for the workshop" }), { target: { value: "Customer waiting" } })
    fireEvent.click(within(scope).getByRole("button", { name: "Back" }))
    fireEvent.click(within(scope).getByRole("checkbox", { name: "Copy the description into Notes" }))
    expect(within(scope).getByText("Notes already has other text, so the description is not copied into it.")).toBeInTheDocument()
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    const own = await within(scope).findByRole("textbox", { name: "Notes for the workshop" })
    expect(own).toHaveValue("Customer waiting")
    expect(own).not.toHaveAccessibleDescription(/Copied from the description/)
  })

  it("books with the description as notes when the box stays ticked", async () => {
    const api = mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      triage: () => triageAnswer("suggest", [[interimServiceType, 0.9]]),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "Due an interim service")
    fireEvent.click(await within(scope).findByRole("button", { name: "Use this" }))
    fireEvent.click(await within(scope).findByRole("radio", { name: /^10:15/ }))
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    await within(scope).findByRole("heading", { name: "Customer and vehicle" })
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    await screen.findByText("Booked")
    const [booking] = bookingRequests(api.requests)
    expect(((await booking.clone().json()) as BookAppointmentRequest).notes).toBe("Due an interim service")
  })

  it("keeps the description to the suggestion request when the box is unticked", async () => {
    const description = "Brakes squeal, call Grace on her mobile"
    const api = mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      triage: () => triageAnswer("suggest", [[interimServiceType, 0.9]]),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, description)
    fireEvent.click(await within(scope).findByRole("button", { name: "Use this" }))
    fireEvent.click(within(scope).getByRole("checkbox", { name: "Copy the description into Notes" }))
    fireEvent.click(await within(scope).findByRole("radio", { name: /^10:15/ }))
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    expect(await within(scope).findByRole("textbox", { name: "Notes for the workshop" })).toHaveValue("")
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))
    await screen.findByText("Booked")

    const [booking] = bookingRequests(api.requests)
    expect(((await booking.clone().json()) as BookAppointmentRequest).notes).toBeUndefined()
    // Only the suggestion request carries it: no address, no other body.
    const carrying = []
    for (const request of api.requests) {
      const body = request.body ? await request.clone().text() : ""
      if (`${request.url} ${body}`.includes("squeal")) carrying.push(new URL(request.url).pathname)
    }
    expect(carrying).toEqual([`/api/v1/dealerships/${reading.id}/booking-triage`])
  })
})

describe("suggesting a service on a phone", () => {
  beforeEach(() => phoneViewport())

  it("suggests in the full-screen sheet, and Book another starts from an empty description", async () => {
    mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      triage: () => triageAnswer("suggest", [[interimServiceType, 0.9]]),
    })
    renderBoard(readingBoard)
    fireEvent.click(await screen.findByRole("button", { name: "Book appointment" }))
    const scope = await dialog()
    expect(scope).toHaveAttribute("data-side", "bottom")

    await describeAndSuggest(scope, "Due an interim service")
    fireEvent.click(await within(scope).findByRole("button", { name: "Use this" }))
    const chip = await within(scope).findByRole("radio", { name: /^10:15/ })
    await waitFor(() => expect(chip).toHaveFocus())
    fireEvent.click(chip)
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    await within(scope).findByRole("heading", { name: "Customer and vehicle" })
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))
    fireEvent.click(await within(scope).findByRole("button", { name: "Book another" }))

    expect(await describeIssue(scope)).toHaveValue("")
    expect(within(scope).queryByRole("radiogroup", { name: "Suggested services" })).not.toBeInTheDocument()
    expect(within(scope).getByRole("checkbox", { name: "Copy the description into Notes" })).toBeChecked()
  })
})

describe("photo-assisted triage", () => {
  const imageId = "550e8400-e29b-41d4-a716-446655440000"
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test-photo") })
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() })
  })

  it("uploads photos before evaluation, reuses the private ID, and invalidates a suggestion when a photo is removed", async () => {
    const api = mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      uploadTriageImage: (_dealership, body) => ({ imageId, contentType: body.contentType, sizeBytes: 4, expiresAt: "2026-10-13T09:30:00Z" }),
      triage: () => triageAnswer("suggest", [[brakesServiceType, 0.99]]),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    const photo = new File([new Uint8Array([137, 80, 78, 71])], "private-vehicle-photo.png", { type: "image/png" })
    fireEvent.change(within(scope).getByLabelText("Photos or paperwork (optional)"), { target: { files: [photo] } })
    expect(within(scope).getByAltText("Selected photo: private-vehicle-photo.png")).toBeInTheDocument()
    await describeAndSuggest(scope)
    await within(scope).findByRole("button", { name: "Use this" })
    const uploads = api.requests.filter(request => new URL(request.url).pathname.endsWith("/booking-triage/images"))
    expect(uploads).toHaveLength(1)
    expect(await uploads[0].clone().json()).toEqual({ contentType: "image/png", base64: "iVBORw==" })
    expect(await triageRequests(api.requests)[0].clone().json()).toEqual({ description: "Brakes squeal, it's an EV, need it Thursday", imageIds: [imageId] })
    expect(bookingRequests(api.requests)).toHaveLength(0)
    fireEvent.click(within(scope).getByRole("button", { name: "Suggest a service" }))
    await waitFor(() => expect(triageRequests(api.requests)).toHaveLength(2))
    await waitFor(() => expect(within(scope).getByRole("button", { name: "Remove photo 1: private-vehicle-photo.png" })).not.toBeDisabled())
    expect(api.requests.filter(request => new URL(request.url).pathname.endsWith("/booking-triage/images"))).toHaveLength(1)
    fireEvent.click(within(scope).getByRole("button", { name: "Remove photo 1: private-vehicle-photo.png" }))
    expect(within(scope).getByText("The description or photos have changed since these suggestions. Suggest again to update them.")).toBeInTheDocument()
    expectUnavailableButFocusable(within(scope).getByRole("button", { name: "Use this" }))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-photo")
  })

  it("rejects PDFs, oversized files and too many photos before uploading", async () => {
    const api = mockBoardApi({ triageStatus: () => triageEnabled, serviceTypes: catalogue })
    renderBoard(readingBoard)
    const scope = await openDialog()
    const input = within(scope).getByLabelText("Photos or paperwork (optional)")
    fireEvent.change(input, { target: { files: [new File(["paper"], "paper.pdf", { type: "application/pdf" })] } })
    expect(within(scope).getByText("Choose PNG, JPEG or WebP photos.")).toBeInTheDocument()
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(4 * 1024 * 1024 + 1)], "large.png", { type: "image/png" })] } })
    expect(within(scope).getByText("Each photo must contain 1 byte to 4 MiB.")).toBeInTheDocument()
    fireEvent.change(input, { target: { files: Array.from({ length: 5 }, (_, index) => new File(["x"], `${index}.png`, { type: "image/png" })) } })
    expect(within(scope).getByText("Choose at most 4 photos.")).toBeInTheDocument()
    expect(api.requests.some(request => request.method === "POST")).toBe(false)
  })
})
