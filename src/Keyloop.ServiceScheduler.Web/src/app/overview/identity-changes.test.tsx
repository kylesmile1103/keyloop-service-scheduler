import { focusManager } from "@tanstack/react-query"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { AppointmentResponse, CurrentUserResponse } from "@/api/types.gen"
import { IDENTITY_CHECK_FAILED } from "@/components/auth/identity-check-failed"
import { rangeReadOptions, rangeReadsOf } from "@/lib/appointment-range"
import { currentUserQueryKey, READ_ONLY_REASON } from "@/lib/session"
import { bookedFrom, defaultSchedule, mockBoardApi, rangeFromSchedules, requestsTo } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import {
  cachedText,
  deferred,
  expectNothingPersonal,
  maskedItem,
  maskedSchedule,
  pressBeforeTheChangeIsDrawn,
  recordDialogs,
  refocus,
} from "@/test/identity-change"
import { admin, anonymous, noRole, viewer } from "@/test/identities"
import { pointerClick, renderBoard } from "@/test/render-board"
import { interimDetails, interimServiceType } from "@/test/schedules"

import { overviewWindow } from "./lib/overview"

// The Overview and who is signed in (Task 28b, after Task 27b's review round 1, ARCHITECTURE §15). An upcoming row's
// details sheet holds the row as one caller read it, outside the query cache, so it closes in the same render as a change
// of identity; the writes the page starts (Book appointment, cancelling from that sheet) are checked as they are sent, and
// an answer that arrives for a previous caller is thrown away, with no toast and no re-read of the range.

beforeAll(async () => {
  await Promise.all([import("@/app/overview/page"), import("@/app/dispatch/page")])
})

beforeEach(() => {
  // Tuesday 2026-10-13, 07:30 in Reading (BST): Sophie Turner's Interim Service at 08:00 is the first upcoming appointment.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T06:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
  focusManager.setFocused(undefined)
})

const overview = `/overview?dealership=${reading.id}`
const interimRow = "Today, Interim Service, Bay 1 - Standard, 08:00 to 09:00, Sophie Turner, Amelia Clarke, Confirmed"
const rangeReads = (requests: readonly Request[]) => requestsTo(requests, "/appointments").filter((request) => request.method === "GET")
const recordReads = (requests: readonly Request[]) => requestsTo(requests, `/api/v1/appointments/${interimDetails.id}`).length
const writes = (requests: readonly Request[]) => requests.filter((request) => request.method !== "GET")
const posts = (requests: readonly Request[], suffix: string) =>
  requests.filter((request) => request.method === "POST" && new URL(request.url).pathname.endsWith(suffix))

/** The Overview's range read on the fake today, as the page builds its key. */
const rangeKey = () => rangeReadOptions(reading.id, overviewWindow("2026-10-13").from, overviewWindow("2026-10-13").to).queryKey

type Caller = CurrentUserResponse | "unreadable"
const holdsRole = (me: Caller) => me !== "unreadable" && me.authenticated && me.roles.length > 0

/** The API as each caller gets it: `/me` (a 502 while it cannot be read), and the range and the day masked without a role. */
function mockApiAs(caller: () => Caller, options: Parameters<typeof mockBoardApi>[0] = {}) {
  return mockBoardApi({
    me: () => {
      const me = caller()
      return me === "unreadable" ? new Response("", { status: 502, statusText: "Bad Gateway" }) : me
    },
    schedule: (id, date) => (holdsRole(caller()) ? defaultSchedule(id, date) : maskedSchedule(defaultSchedule(id, date))),
    range: (id, from, to) => (holdsRole(caller()) ? rangeFromSchedules(id, from, to) : rangeFromSchedules(id, from, to).map(maskedItem)),
    ...options,
  })
}

/** Opens Sophie Turner's Interim Service from the upcoming list, once its whole record is on screen. */
async function openInterim() {
  const region = await screen.findByRole("region", { name: "Upcoming appointments" })
  fireEvent.click(await within(region).findByRole("button", { name: interimRow }))
  const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
  expect(await within(sheet).findByRole("link", { name: "sophie.turner@example.com" })).toBeInTheDocument()
  return sheet
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

/** Book appointment's dialog, step 1 (Interim Service at 10:15) and step 2's customer and vehicle, ready for Book. */
async function enterBooking() {
  fireEvent.click(await screen.findByRole("button", { name: "Book appointment" }))
  const dialog = await screen.findByRole("dialog", { name: "Book appointment" })
  fireEvent.click(await within(dialog).findByRole("combobox", { name: "Service" }))
  pointerClick(await screen.findByRole("option", { name: /^Interim Service/ }))
  fireEvent.click(await within(dialog).findByRole("radio", { name: "10:15, 4 bays and 3 technicians free" }))
  fireEvent.click(within(dialog).getByRole("button", { name: "Next" }))
  await within(dialog).findByRole("heading", { name: "Customer and vehicle" })
  for (const [label, value] of Object.entries(customer)) fireEvent.change(within(dialog).getByRole("textbox", { name: label }), { target: { value } })
  return dialog
}

describe("an upcoming appointment's details sheet when the identity changes", () => {
  it.each<[string, Caller, string | null]>([
    // What the sheet would show only for the next caller: it must never be drawn beside the booking's details.
    ["signs out", anonymous, "Sign in to see the whole booking"],
    ["becomes a Viewer", viewer, READ_ONLY_REASON],
    ["cannot be checked", "unreadable", "Sign in to see the whole booking"],
    ["loses every role", noRole, "Your account has no workshop role yet"],
    ["keeps the email with another writing role", { ...admin, roles: ["ServiceAdvisor"] }, null],
  ])("closes before it is drawn for the caller who %s, leaving nothing of the booking's row or record", async (_, next, nextCallersView) => {
    let me: Caller = admin
    const { requests } = mockApiAs(() => me)
    const { queryClient } = renderBoard(overview)
    const sheet = await openInterim()
    const readsBefore = recordReads(requests)
    const dialogs = recordDialogs()

    me = next
    refocus()

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Interim Service" })).not.toBeInTheDocument())
    // The whole sheet as it closed, and every state any dialog was drawn in meanwhile.
    expectNothingPersonal(sheet.textContent, "the closed sheet")
    for (const text of dialogs.stop()) {
      if (nextCallersView !== null && text.includes(nextCallersView)) expectNothingPersonal(text, "a dialog drawn for the next caller")
    }
    expect(cachedText(queryClient)).not.toContain("sophie.turner@example.com")
    if (!holdsRole(next)) {
      // The page itself read again as the new caller: masked, as the API answers it, and the record was not asked for.
      expect(await screen.findByRole("button", { name: "Today, Interim Service, Bay 1 - Standard, 08:00 to 09:00, ST, Amelia Clarke, Confirmed" })).toBeInTheDocument()
      expectNothingPersonal(document.body.textContent, "the page")
      expect(recordReads(requests)).toBe(readsBefore)
    }
  })

  it("leaves focus in the page's content, and opens again as the new caller sees it", async () => {
    let me: Caller = admin
    const { requests } = mockApiAs(() => me)
    renderBoard(overview)
    await openInterim()
    const readsBefore = recordReads(requests)

    me = anonymous
    refocus()

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Interim Service" })).not.toBeInTheDocument())
    await waitFor(() => expect(document.activeElement).not.toBe(document.body))
    expect(document.getElementById("content")?.contains(document.activeElement)).toBe(true)

    fireEvent.click(await screen.findByRole("button", { name: "Today, Interim Service, Bay 1 - Standard, 08:00 to 09:00, ST, Amelia Clarke, Confirmed" }))
    const again = await screen.findByRole("dialog", { name: "Interim Service" })
    expect(within(again).getByRole("region", { name: "Sign in to see the whole booking" })).toBeInTheDocument()
    expectNothingPersonal(again.textContent, "the sheet opened again")
    expect(recordReads(requests)).toBe(readsBefore)
  })
})

describe.each<[string, CurrentUserResponse]>([
  ["signs out", anonymous],
  ["becomes a Viewer", viewer],
])("an answer that arrives after the caller %s", (_, next) => {
  it("to Book appointment is thrown away: no toast, nothing cached, and the range is not read again for it", async () => {
    let me: Caller = admin
    const answer = deferred<AppointmentResponse>()
    const api = mockApiAs(() => me, { serviceTypes: () => [interimServiceType], book: () => answer.promise })
    const { queryClient } = renderBoard(overview)
    await screen.findByRole("region", { name: "Bookings per day" })
    const dialog = await enterBooking()
    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))
    await waitFor(() => expect(posts(api.requests, "/appointments")).toHaveLength(1))
    const body = await posts(api.requests, "/appointments")[0].clone().json()

    me = next
    refocus()
    await waitFor(() => expect(queryClient.getQueryData(currentUserQueryKey())).toEqual(next))
    // The range is read again once, as the new caller; then the late answer arrives.
    await waitFor(() => expect(queryClient.getQueryState(rangeKey())?.status).toBe("success"))
    const rangeReadsBefore = rangeReads(api.requests).length
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    answer.release(bookedFrom(body))

    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryAllByText("Booked")).toHaveLength(0)
    expect(screen.queryByRole("button", { name: "View on board" })).not.toBeInTheDocument()
    expect(invalidate).not.toHaveBeenCalled()
    expect(rangeReads(api.requests)).toHaveLength(rangeReadsBefore)
    expect(cachedText(queryClient)).not.toContain("draft.private@example.invalid")
    expect(cachedText(queryClient)).not.toContain("Draft Private Customer")
  })

  it("to a cancellation from an upcoming row's sheet is thrown away: no toast, no record cached, and no range re-read", async () => {
    let me: Caller = admin
    const answer = deferred<AppointmentResponse>()
    const api = mockApiAs(() => me, { cancel: () => answer.promise })
    const { queryClient } = renderBoard(overview)
    const sheet = await openInterim()
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Reason" }), { target: { value: "Customer rang" } })
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel appointment" }))
    await waitFor(() => expect(posts(api.requests, "/cancel")).toHaveLength(1))

    me = next
    refocus()
    await waitFor(() => expect(queryClient.getQueryData(currentUserQueryKey())).toEqual(next))
    await waitFor(() => expect(queryClient.getQueryState(rangeKey())?.status).toBe("success"))
    const rangeReadsBefore = rangeReads(api.requests).length
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    answer.release({ ...interimDetails, status: "Cancelled", cancellationReason: "Customer rang" })

    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryAllByText("Appointment cancelled")).toHaveLength(0)
    expect(invalidate).not.toHaveBeenCalled()
    expect(rangeReads(api.requests)).toHaveLength(rangeReadsBefore)
    expect(cachedText(queryClient)).not.toContain("sophie.turner@example.com")
    expect(cachedText(queryClient)).not.toContain("Customer rang")
  })
})

describe("a write from the Overview, checked as it is sent", () => {
  it.each<[string, CurrentUserResponse]>([
    ["signed out", anonymous],
    ["a Viewer", viewer],
  ])("sends no booking from Book appointment once the identity in the cache is %s, before the view has drawn it", async (_, next) => {
    const api = mockApiAs(() => admin, { serviceTypes: () => [interimServiceType] })
    const { queryClient } = renderBoard(overview)
    const dialog = await enterBooking()

    // The new identity is in the cache and Book is pressed before React has rendered it: only the send can stop the write.
    queryClient.setQueryData(currentUserQueryKey(), next)
    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(posts(api.requests, "/appointments")).toHaveLength(0)
  })

  it("sends no cancellation from an upcoming row's sheet", async () => {
    const api = mockApiAs(() => admin)
    const { queryClient } = renderBoard(overview)
    const sheet = await openInterim()
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Reason" }), { target: { value: "Customer rang" } })

    queryClient.setQueryData(currentUserQueryKey(), viewer)
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel appointment" }))

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(posts(api.requests, "/cancel")).toHaveLength(0)
  })
})

describe("Book appointment, decided from the cached /me as it is pressed", () => {
  it("asks a caller who has just signed out to sign in, though the page still showed a caller who could book", async () => {
    let me: Caller = admin
    const { requests } = mockApiAs(() => me)
    const { queryClient } = renderBoard(overview)
    const book = await screen.findByRole("button", { name: "Book appointment" })
    await waitFor(() => expect(book).not.toHaveAttribute("aria-disabled", "true"))

    me = anonymous
    expect(await pressBeforeTheChangeIsDrawn(queryClient, book)).toBe(true)

    expect(await screen.findByRole("dialog", { name: "Sign in to book" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Book appointment" })).not.toBeInTheDocument()
    expect(writes(requests)).toHaveLength(0)
  })

  it("opens nothing for a caller who has just become a Viewer, and the page then names the reason", async () => {
    let me: Caller = admin
    const { requests } = mockApiAs(() => me)
    const { queryClient } = renderBoard(overview)
    const book = await screen.findByRole("button", { name: "Book appointment" })
    await waitFor(() => expect(book).not.toHaveAttribute("aria-disabled", "true"))

    me = viewer
    expect(await pressBeforeTheChangeIsDrawn(queryClient, book)).toBe(true)

    expect(await screen.findByText(READ_ONLY_REASON)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Book appointment" })).toHaveAttribute("aria-disabled", "true")
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(writes(requests)).toHaveLength(0)
  })

  it("asks to sign in, saying the check failed, when /me has just failed to be read again", async () => {
    let me: Caller = admin
    const { requests } = mockApiAs(() => me)
    const { queryClient } = renderBoard(overview)
    const book = await screen.findByRole("button", { name: "Book appointment" })
    await waitFor(() => expect(book).not.toHaveAttribute("aria-disabled", "true"))

    me = "unreadable"
    expect(await pressBeforeTheChangeIsDrawn(queryClient, book)).toBe(true)

    const prompt = await screen.findByRole("dialog", { name: "Sign in to book" })
    expect(within(prompt).getByText(IDENTITY_CHECK_FAILED)).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Book appointment" })).not.toBeInTheDocument()
    expect(writes(requests)).toHaveLength(0)
  })
})

describe("a booking answered for the caller who sent it", () => {
  it("still reads the Overview's range again", async () => {
    const api = mockApiAs(() => admin, { serviceTypes: () => [interimServiceType] })
    const { queryClient } = renderBoard(overview)
    await screen.findByRole("region", { name: "Bookings per day" })
    const dialog = await enterBooking()
    const rangeReadsBefore = rangeReads(api.requests).length
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")

    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))

    await screen.findByText("Booked")
    expect(invalidate).toHaveBeenCalledWith({ queryKey: rangeReadsOf(reading.id) })
    await waitFor(() => expect(rangeReads(api.requests).length).toBeGreaterThan(rangeReadsBefore))
  })
})

describe("while /me cannot be read", () => {
  it("asks to sign in from Book appointment, says the check failed, and sends no write and no record read", async () => {
    const { requests } = mockApiAs(() => "unreadable")
    renderBoard(overview)

    fireEvent.click(await screen.findByRole("button", { name: "Book appointment" }))
    const prompt = await screen.findByRole("dialog", { name: "Sign in to book" })
    expect(within(prompt).getByText(IDENTITY_CHECK_FAILED)).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Book appointment" })).not.toBeInTheDocument()
    fireEvent.click(within(prompt).getByRole("button", { name: "Not now" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sign in to book" })).not.toBeInTheDocument())

    fireEvent.click(await screen.findByRole("button", { name: "Today, Interim Service, Bay 1 - Standard, 08:00 to 09:00, ST, Amelia Clarke, Confirmed" }))
    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    expect(within(sheet).getByRole("region", { name: "Sign in to see the whole booking" })).toBeInTheDocument()
    expect(within(sheet).queryByRole("textbox", { name: "Reason" })).not.toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(recordReads(requests)).toBe(0)
    expect(writes(requests)).toHaveLength(0)
  })
})
