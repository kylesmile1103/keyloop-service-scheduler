import { focusManager, type QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { AppointmentResponse, CurrentUserResponse, TriageBookingResponse, UploadBookingTriageImageResponse } from "@/api/types.gen"
import { createQueryClient } from "@/lib/query-client"
import { currentUserQueryKey } from "@/lib/session"
import { bookedFrom, mockBoardApi } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { expectUnavailableButFocusable } from "@/test/focus"
import { admin, anonymous, viewer } from "@/test/identities"
import { problemResponse } from "@/test/mock-api"
import { pointerClick, renderBoard } from "@/test/render-board"
import { interimDetails, interimServiceType } from "@/test/schedules"
import { brakesServiceType, triageAnswer, triageEnabled, triageUnavailable } from "@/test/triage"

import { BookingTriageIntake } from "./components/booking-triage"
import { useBookingTriage } from "./hooks/use-booking-triage"

// Writes and who is signed in (Task 27b, review round 1): an answer that arrives after the identity changed is thrown
// away (never cached, never kept in a mutation, no toast or other effect for the next caller), and every write checks,
// as it is sent and after each step it awaits, that the caller may still write.

beforeAll(async () => {
  await import("@/app/dispatch/page")
})

beforeEach(() => {
  // Tuesday 2026-10-13, 09:30 in Reading (BST). Only Date is faked; timers stay real for the UI.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test-photo") })
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() })
})
afterEach(() => {
  vi.useRealTimers()
  focusManager.setFocused(undefined)
})

const board = `/dispatch?dealership=${reading.id}`
const interimLabel = "Interim Service, Bay 1 - Standard, 08:00 to 09:00, Amelia Clarke, Confirmed"
const imageId = "550e8400-e29b-41d4-a716-446655440000"

const posts = (requests: readonly Request[], suffix: string) =>
  requests.filter((request) => request.method === "POST" && new URL(request.url).pathname.endsWith(suffix))

function refocus() {
  act(() => {
    focusManager.setFocused(false)
    focusManager.setFocused(true)
  })
}

/** Everything the cache holds: every query's data and every mutation's state (its variables, data and error). */
function cached(queryClient: QueryClient): string {
  return JSON.stringify({
    queries: queryClient.getQueryCache().getAll().map((query) => query.state.data),
    mutations: queryClient.getMutationCache().getAll().map((mutation) => mutation.state),
  })
}

/** A deferred answer: the request is held until the test lets it through. */
function deferred<T>() {
  let release!: (value: T | Response) => void
  const promise = new Promise<T | Response>((resolve) => {
    release = resolve
  })
  return { promise, release: (value: T | Response) => act(() => release(value)) }
}

const customer = {
  Name: "Draft Private Customer",
  Email: "draft.private@example.invalid",
  Phone: "+44 7700 900777",
  VIN: "WVWZZZ1KZAW654321",
  Registration: "DR22 AFT",
  Make: "Volkswagen",
  Model: "Golf",
}

async function openBooking() {
  fireEvent.click(await screen.findByRole("button", { name: "Book appointment" }))
  return screen.findByRole("dialog", { name: "Book appointment" })
}

/** Step 1 by hand (Interim Service at 10:15), then step 2's customer and vehicle. */
async function enterBooking(dialog: HTMLElement) {
  fireEvent.click(await within(dialog).findByRole("combobox", { name: "Service" }))
  pointerClick(await screen.findByRole("option", { name: /^Interim Service/ }))
  fireEvent.click(await within(dialog).findByRole("radio", { name: "10:15, 4 bays and 3 technicians free" }))
  fireEvent.click(within(dialog).getByRole("button", { name: "Next" }))
  await within(dialog).findByRole("heading", { name: "Customer and vehicle" })
  for (const [label, value] of Object.entries(customer)) {
    fireEvent.change(within(dialog).getByRole("textbox", { name: label }), { target: { value } })
  }
}

describe.each<[string, CurrentUserResponse]>([
  ["signs out", anonymous],
  ["becomes a Viewer", viewer],
])("an answer that arrives after the caller %s", (_, next) => {
  it("to a booking is thrown away: no toast, no closing, nothing cached or kept in the mutation", async () => {
    let me: CurrentUserResponse = admin
    const answer = deferred<AppointmentResponse>()
    const api = mockBoardApi({ me: () => me, serviceTypes: () => [interimServiceType], book: () => answer.promise })
    const { queryClient } = renderBoard(board)
    const dialog = await openBooking()
    await enterBooking(dialog)
    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))
    await waitFor(() => expect(posts(api.requests, "/appointments")).toHaveLength(1))
    const body = await posts(api.requests, "/appointments")[0].clone().json()

    me = next
    refocus()
    await waitFor(() => expect(queryClient.getQueryData(currentUserQueryKey())).toEqual(next))
    answer.release(bookedFrom(body))

    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryAllByText("Booked")).toHaveLength(0)
    // Still open: the answer did not close it for the next caller.
    expect(screen.getByRole("dialog", { name: "Book appointment" })).toBeInTheDocument()
    expect(within(dialog).queryByRole("button", { name: "Booking…" })).not.toBeInTheDocument()
    expect(cached(queryClient)).not.toContain("draft.private@example.invalid")
    expect(cached(queryClient)).not.toContain("Draft Private Customer")
  })

  it("refusing a booking shows nothing for the next caller either", async () => {
    let me: CurrentUserResponse = admin
    const answer = deferred<AppointmentResponse>()
    const api = mockBoardApi({ me: () => me, serviceTypes: () => [interimServiceType], book: () => answer.promise })
    const { queryClient } = renderBoard(board)
    const dialog = await openBooking()
    await enterBooking(dialog)
    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))
    await waitFor(() => expect(posts(api.requests, "/appointments")).toHaveLength(1))

    me = next
    refocus()
    await waitFor(() => expect(queryClient.getQueryData(currentUserQueryKey())).toEqual(next))
    answer.release(problemResponse(500, { type: "about:blank", title: "Internal Server Error", status: 500 }))

    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryAllByText("Couldn’t book the appointment")).toHaveLength(0)
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument()
    expect(cached(queryClient)).not.toContain("draft.private@example.invalid")
  })

  it("to a cancellation is thrown away: the record is not cached, no toast, nothing kept in the mutation", async () => {
    let me: CurrentUserResponse = admin
    const answer = deferred<AppointmentResponse>()
    const api = mockBoardApi({ me: () => me, cancel: () => answer.promise })
    const { queryClient } = renderBoard(board)
    fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    await within(sheet).findByRole("link", { name: "sophie.turner@example.com" })
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Reason" }), { target: { value: "Customer rang" } })
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel appointment" }))
    await waitFor(() => expect(posts(api.requests, "/cancel")).toHaveLength(1))

    me = next
    refocus()
    await waitFor(() => expect(queryClient.getQueryData(currentUserQueryKey())).toEqual(next))
    answer.release({ ...interimDetails, status: "Cancelled", cancellationReason: "Customer rang" })

    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryAllByText("Appointment cancelled")).toHaveLength(0)
    expect(cached(queryClient)).not.toContain("sophie.turner@example.com")
    expect(cached(queryClient)).not.toContain("Customer rang")
  })

  it("to a suggestion is thrown away: no cards, and the description is not kept in the mutation", async () => {
    let me: CurrentUserResponse = admin
    const answer = deferred<TriageBookingResponse>()
    const api = mockBoardApi({
      me: () => me,
      triageStatus: () => triageEnabled,
      serviceTypes: () => [interimServiceType, brakesServiceType],
      triage: () => answer.promise,
    })
    const { queryClient } = renderBoard(board)
    const dialog = await openBooking()
    fireEvent.change(await within(dialog).findByRole("textbox", { name: "Describe the issue" }), { target: { value: "Private brake noise" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Suggest a service" }))
    await waitFor(() => expect(posts(api.requests, "/booking-triage")).toHaveLength(1))

    me = next
    refocus()
    await waitFor(() => expect(queryClient.getQueryData(currentUserQueryKey())).toEqual(next))
    answer.release(triageAnswer("suggest", [[brakesServiceType, 0.95]]))

    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(within(dialog).queryByRole("radiogroup", { name: "Suggested services" })).not.toBeInTheDocument()
    expect(cached(queryClient)).not.toContain("Private brake noise")
  })
})

describe("a photo upload that answers after the identity changed", () => {
  it("is not kept for reuse: the next suggestion uploads the photo again as the new caller", async () => {
    let me: CurrentUserResponse = admin
    const uploads: Array<ReturnType<typeof deferred<UploadBookingTriageImageResponse>>> = []
    const api = mockBoardApi({
      me: () => me,
      triageStatus: () => triageEnabled,
      serviceTypes: () => [interimServiceType, brakesServiceType],
      uploadTriageImage: () => {
        const upload = deferred<UploadBookingTriageImageResponse>()
        uploads.push(upload)
        return upload.promise
      },
      triage: () => triageAnswer("suggest", [[brakesServiceType, 0.95]]),
    })
    const { queryClient } = renderBoard(board)
    const dialog = await openBooking()
    const photo = new File([new Uint8Array([137, 80, 78, 71])], "dashboard.png", { type: "image/png" })
    fireEvent.change(within(dialog).getByLabelText("Photos or paperwork (optional)"), { target: { files: [photo] } })
    fireEvent.change(await within(dialog).findByRole("textbox", { name: "Describe the issue" }), { target: { value: "Warning light" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Suggest a service" }))
    await waitFor(() => expect(uploads).toHaveLength(1))

    // The same email with another role that may book: the draft stays, but the upload's answer is the previous caller's.
    me = { ...admin, roles: ["ServiceAdvisor"] }
    refocus()
    await waitFor(() => expect(queryClient.getQueryData(currentUserQueryKey())).toEqual(me))
    uploads[0].release({ imageId, contentType: "image/png", sizeBytes: 4, expiresAt: "2026-10-13T09:30:00Z" })
    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    expect(posts(api.requests, "/booking-triage")).toHaveLength(0)

    const suggest = within(dialog).getByRole("button", { name: "Suggest a service" })
    await waitFor(() => expect(suggest).not.toHaveAttribute("aria-disabled", "true"))
    fireEvent.click(suggest)
    await waitFor(() => expect(uploads).toHaveLength(2))
    uploads[1].release({ imageId, contentType: "image/png", sizeBytes: 4, expiresAt: "2026-10-13T09:30:00Z" })
    await within(dialog).findByRole("radiogroup", { name: "Suggested services" })
    expect(posts(api.requests, "/booking-triage/images")).toHaveLength(2)
    expect(posts(api.requests, "/booking-triage")).toHaveLength(1)
  })
})

describe("a write checked as it is sent", () => {
  it.each<[string, CurrentUserResponse]>([
    ["signed out", anonymous],
    ["a Viewer", viewer],
  ])("sends nothing from Try again once the identity in the cache is %s, before the view has drawn it", async (_, next) => {
    const api = mockBoardApi({
      me: () => admin,
      triageStatus: () => triageEnabled,
      triage: () => problemResponse(503, triageUnavailable),
    })
    const { queryClient } = renderBoard(board)
    const dialog = await openBooking()
    fireEvent.change(await within(dialog).findByRole("textbox", { name: "Describe the issue" }), { target: { value: "Brakes squeal" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Suggest a service" }))
    const retry = await within(dialog).findByRole("button", { name: "Try again" })
    expect(posts(api.requests, "/booking-triage")).toHaveLength(1)

    // The new identity is in the cache, and the button is pressed before React has rendered it (TanStack tells the views on
    // its next tick): only the send itself can stop the write.
    queryClient.setQueryData(currentUserQueryKey(), next)
    fireEvent.click(retry)

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(posts(api.requests, "/booking-triage")).toHaveLength(1)
  })

  it("sends nothing from Suggest a service either", async () => {
    const api = mockBoardApi({ me: () => admin, triageStatus: () => triageEnabled })
    const { queryClient } = renderBoard(board)
    const dialog = await openBooking()
    fireEvent.change(await within(dialog).findByRole("textbox", { name: "Describe the issue" }), { target: { value: "Brakes squeal" } })

    queryClient.setQueryData(currentUserQueryKey(), viewer)
    fireEvent.click(within(dialog).getByRole("button", { name: "Suggest a service" }))

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(posts(api.requests, "/booking-triage")).toHaveLength(0)
  })

  it("sends no booking from Book", async () => {
    const api = mockBoardApi({ me: () => admin, serviceTypes: () => [interimServiceType] })
    const { queryClient } = renderBoard(board)
    const dialog = await openBooking()
    await enterBooking(dialog)

    queryClient.setQueryData(currentUserQueryKey(), anonymous)
    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(posts(api.requests, "/appointments")).toHaveLength(0)
  })

  it("sends no cancellation", async () => {
    const api = mockBoardApi({ me: () => admin })
    const { queryClient } = renderBoard(board)
    fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Reason" }), { target: { value: "Customer rang" } })

    queryClient.setQueryData(currentUserQueryKey(), viewer)
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel appointment" }))

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(posts(api.requests, "/cancel")).toHaveLength(0)
  })

  it("stops between photo uploads and before the suggestion once the role is lost while a photo uploads", async () => {
    let me: CurrentUserResponse = admin
    const firstUpload = deferred<UploadBookingTriageImageResponse>()
    const api = mockBoardApi({
      me: () => me,
      triageStatus: () => triageEnabled,
      serviceTypes: () => [interimServiceType, brakesServiceType],
      uploadTriageImage: () => firstUpload.promise,
      triage: () => triageAnswer("suggest", [[brakesServiceType, 0.95]]),
    })
    const { queryClient } = renderBoard(board)
    const dialog = await openBooking()
    const photos = ["dashboard.png", "tyre.png"].map((name) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" }))
    fireEvent.change(within(dialog).getByLabelText("Photos or paperwork (optional)"), { target: { files: photos } })
    fireEvent.change(await within(dialog).findByRole("textbox", { name: "Describe the issue" }), { target: { value: "Warning light" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Suggest a service" }))
    await waitFor(() => expect(posts(api.requests, "/booking-triage/images")).toHaveLength(1))

    me = viewer
    refocus()
    await waitFor(() => expect(queryClient.getQueryData(currentUserQueryKey())).toEqual(viewer))
    firstUpload.release({ imageId, contentType: "image/png", sizeBytes: 4, expiresAt: "2026-10-13T09:30:00Z" })

    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(posts(api.requests, "/booking-triage/images")).toHaveLength(1)
    expect(posts(api.requests, "/booking-triage")).toHaveLength(0)
  })
})

/** Another account that may book and cancel: the same role as `admin`, another email. */
const otherAdmin: CurrentUserResponse = { ...admin, email: "another.admin@keyloop.test", displayName: "Another Admin" }

/** The same email with another role that may book: the draft is still this account's. */
const sameEmailAdvisor: CurrentUserResponse = { ...admin, roles: ["ServiceAdvisor"] }

const slotUnavailable = {
  type: "https://api.keyloop.example/problems/slot-unavailable",
  title: "Slot unavailable",
  status: 409,
  detail: "Every qualified bay or technician is busy at 10:15.",
  suggestedSlots: [{ startUtc: "2026-10-13T09:30:00Z", endUtc: "2026-10-13T10:30:00Z", startLocal: "2026-10-13T10:30+01:00" }],
}

/** The booking dialog's form, submitted as Enter in one of its fields submits it. */
function submitFromKeyboard(dialog: HTMLElement) {
  act(() => dialog.querySelector("form")!.requestSubmit())
}

/** Lets the form's checks (they resolve on later ticks), the send and TanStack's notifications all run. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 150)))

/**
 * Nothing of the discarded draft anywhere: not on screen (text or a field's value), not in any query's data, not in any
 * mutation's state, and no mutation left in the cache at all.
 */
function expectDraftNowhere(queryClient: QueryClient) {
  const values = [customer.Name, customer.Email, customer.Phone, customer.VIN, customer.Registration]
  const fields = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].map((field) => field.value)
  for (const value of values) {
    expect(document.body.textContent).not.toContain(value)
    expect(fields).not.toContain(value)
    expect(cached(queryClient)).not.toContain(value)
  }
  expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
  expect(queryClient.isMutating()).toBe(0)
}

// Review round 2: a booking discarded because the caller changed is never sent, by any path, for any later caller. A
// submission is bound to the account the dialog was drawn for before the form's checks run, and sent only if the identity
// in the cache is still that account when they pass and the booking has not been discarded meanwhile.
describe("a booking discarded because the caller changed", () => {
  it.each<[string, CurrentUserResponse]>([
    ["signs out", anonymous],
    ["is another account that may book", otherAdmin],
  ])("is never sent when the caller %s while Book's checks run, and nothing of it is kept", async (_, next) => {
    let me: CurrentUserResponse = admin
    const api = mockBoardApi({ me: () => me, serviceTypes: () => [interimServiceType] })
    const { queryClient } = renderBoard(board)
    const dialog = await openBooking()
    await enterBooking(dialog)

    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))
    // The form's checks are still running: /me names the next caller before they pass.
    me = next
    queryClient.setQueryData(currentUserQueryKey(), next)
    await settle()

    expect(posts(api.requests, "/appointments")).toHaveLength(0)
    expect(screen.queryAllByText("Booked")).toHaveLength(0)
    expect(within(dialog).getByText(/The booking you were entering was discarded/)).toBeInTheDocument()
    expectDraftNowhere(queryClient)
  })

  it("is never sent from Book once another account that may book is in the cache, before the dialog has drawn it", async () => {
    let me: CurrentUserResponse = admin
    const api = mockBoardApi({ me: () => me, serviceTypes: () => [interimServiceType] })
    const { queryClient } = renderBoard(board)
    const dialog = await openBooking()
    await enterBooking(dialog)

    me = otherAdmin
    queryClient.setQueryData(currentUserQueryKey(), otherAdmin)
    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))
    await settle()

    expect(posts(api.requests, "/appointments")).toHaveLength(0)
    expect(screen.queryAllByText("Booked")).toHaveLength(0)
    expectDraftNowhere(queryClient)
  })

  it.each<[string, CurrentUserResponse, "before" | "after"]>([
    ["signs out after it is submitted", anonymous, "after"],
    ["is another account that may book, already in the cache when it is submitted", otherAdmin, "before"],
    ["signs out before it is submitted", anonymous, "before"],
    ["is another account that may book, after it is submitted", otherAdmin, "after"],
  ])("is never sent from the keyboard (Enter in a field) when the caller %s", async (_, next, when) => {
    let me: CurrentUserResponse = admin
    const api = mockBoardApi({ me: () => me, serviceTypes: () => [interimServiceType] })
    const { queryClient } = renderBoard(board)
    const dialog = await openBooking()
    await enterBooking(dialog)

    me = next
    if (when === "before") queryClient.setQueryData(currentUserQueryKey(), next)
    submitFromKeyboard(dialog)
    if (when === "after") queryClient.setQueryData(currentUserQueryKey(), next)
    await settle()

    expect(posts(api.requests, "/appointments")).toHaveLength(0)
    expect(screen.queryAllByText("Booked")).toHaveLength(0)
    expectDraftNowhere(queryClient)
  })

  it.each<[string, CurrentUserResponse]>([
    ["signed out", anonymous],
    ["another account that may book", otherAdmin],
  ])("is never sent again from Try again once the identity in the cache is %s, before the dialog has drawn it", async (_, next) => {
    let me: CurrentUserResponse = admin
    const api = mockBoardApi({
      me: () => me,
      serviceTypes: () => [interimServiceType],
      book: () => new Response("", { status: 503, statusText: "Service Unavailable" }),
    })
    const { queryClient } = renderBoard(board)
    const dialog = await openBooking()
    await enterBooking(dialog)
    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))
    const retry = within(await within(dialog).findByRole("alert")).getByRole("button", { name: "Try again" })
    expect(posts(api.requests, "/appointments")).toHaveLength(1)

    me = next
    queryClient.setQueryData(currentUserQueryKey(), next)
    fireEvent.click(retry)
    await settle()

    expect(posts(api.requests, "/appointments")).toHaveLength(1)
    expectDraftNowhere(queryClient)
  })

  it.each<[string, CurrentUserResponse]>([
    ["signs out", anonymous],
    ["is another account that may book", otherAdmin],
  ])("is not sent by a Try again pressed in the same tick as the caller %s, and the stopped write leaves nothing", async (_, next) => {
    let me: CurrentUserResponse = admin
    const api = mockBoardApi({
      me: () => me,
      serviceTypes: () => [interimServiceType],
      book: () => new Response("", { status: 503, statusText: "Service Unavailable" }),
    })
    const { queryClient } = renderBoard(board)
    const dialog = await openBooking()
    await enterBooking(dialog)
    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))
    const retry = within(await within(dialog).findByRole("alert")).getByRole("button", { name: "Try again" })

    // Pressed while the cache still names the Admin, then the identity changes before the request leaves (TanStack starts
    // a mutation's request a few microtasks after it is asked for).
    act(() => {
      fireEvent.click(retry)
      me = next
      queryClient.setQueryData(currentUserQueryKey(), next)
    })
    await settle()

    expect(posts(api.requests, "/appointments")).toHaveLength(1)
    expectDraftNowhere(queryClient)
  })

  it("is never sent from a suggested start once another account that may book is in the cache", async () => {
    let me: CurrentUserResponse = admin
    const api = mockBoardApi({ me: () => me, serviceTypes: () => [interimServiceType], book: () => problemResponse(409, slotUnavailable) })
    const { queryClient } = renderBoard(board)
    const dialog = await openBooking()
    await enterBooking(dialog)
    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))
    const chip = within(await within(dialog).findByRole("alert")).getByRole("button", { name: "Book at 10:30 instead" })

    me = otherAdmin
    queryClient.setQueryData(currentUserQueryKey(), otherAdmin)
    fireEvent.click(chip)
    await settle()

    expect(posts(api.requests, "/appointments")).toHaveLength(1)
    expectDraftNowhere(queryClient)
  })

  it("is still booked, once, when the same email changes to another role that may book while Book's checks run", async () => {
    let me: CurrentUserResponse = admin
    const api = mockBoardApi({ me: () => me, serviceTypes: () => [interimServiceType] })
    const { queryClient } = renderBoard(board)
    const dialog = await openBooking()
    await enterBooking(dialog)

    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))
    me = sameEmailAdvisor
    queryClient.setQueryData(currentUserQueryKey(), sameEmailAdvisor)

    expect(await screen.findByText("Booked")).toBeInTheDocument()
    await settle()
    expect(posts(api.requests, "/appointments")).toHaveLength(1)
    expect(await posts(api.requests, "/appointments")[0].clone().json()).toMatchObject({ customer: { email: customer.Email } })
  })

  it("keeps the same email's draft and its idempotency key: Try again after a change of writing role books it with the original key", async () => {
    let me: CurrentUserResponse = admin
    let attempts = 0
    const api = mockBoardApi({
      me: () => me,
      serviceTypes: () => [interimServiceType],
      book: (_, body) => (++attempts === 1 ? new Response("", { status: 503, statusText: "Service Unavailable" }) : bookedFrom(body)),
    })
    const { queryClient } = renderBoard(board)
    const dialog = await openBooking()
    await enterBooking(dialog)
    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))
    await within(dialog).findByRole("alert")

    me = sameEmailAdvisor
    refocus()
    await waitFor(() => expect(queryClient.getQueryData(currentUserQueryKey())).toEqual(sameEmailAdvisor))
    await settle()
    expect(within(dialog).getByRole("textbox", { name: "Email" })).toHaveValue(customer.Email)
    fireEvent.click(within(within(dialog).getByRole("alert")).getByRole("button", { name: "Try again" }))

    expect(await screen.findByText("Booked")).toBeInTheDocument()
    const [first, second, ...more] = posts(api.requests, "/appointments")
    expect(more).toHaveLength(0)
    expect(second.headers.get("Idempotency-Key")).toBe(first.headers.get("Idempotency-Key"))
  })
})

/** The suggestions section alone, as the booking dialog places it, with the dialog's blocked reason when it is blocked. */
function TriageSection({ blocked }: { blocked: boolean }) {
  const triage = useBookingTriage(reading.id)
  return (
    <>
      <p id="blocked-reason">Your role can view bookings but not change them.</p>
      <BookingTriageIntake
        triage={triage}
        blockedBy={blocked ? "blocked-reason" : undefined}
        dealership={reading}
        today="2026-10-13"
        serviceTypes={[interimServiceType]}
        current={{ serviceTypeId: "", date: "2026-10-13" }}
        notesHaveOwnText={false}
        onUse={() => {}}
      />
    </>
  )
}

describe("Try again in the suggestions' alert", () => {
  it("is unavailable with the same reason as Suggest a service while the account cannot write, and sends nothing", async () => {
    const api = mockBoardApi({ triageStatus: () => triageEnabled, triage: () => problemResponse(503, triageUnavailable) })
    const queryClient = createQueryClient()
    queryClient.setQueryData(currentUserQueryKey(), admin)
    const ui = (blocked: boolean) => (
      <QueryClientProvider client={queryClient}>
        <TriageSection blocked={blocked} />
      </QueryClientProvider>
    )
    const { rerender } = render(ui(false))
    fireEvent.change(screen.getByRole("textbox", { name: "Describe the issue" }), { target: { value: "Brakes squeal" } })
    fireEvent.click(screen.getByRole("button", { name: "Suggest a service" }))
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument()

    queryClient.setQueryData(currentUserQueryKey(), viewer)
    rerender(ui(true))

    const suggest = screen.getByRole("button", { name: "Suggest a service" })
    const retry = screen.getByRole("button", { name: "Try again" })
    expectUnavailableButFocusable(suggest)
    expectUnavailableButFocusable(retry)
    expect(retry).toHaveAttribute("aria-describedby", "blocked-reason")
    expect(suggest).toHaveAttribute("aria-describedby", "blocked-reason")
    fireEvent.click(retry)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(posts(api.requests, "/booking-triage")).toHaveLength(1)
  })
})
