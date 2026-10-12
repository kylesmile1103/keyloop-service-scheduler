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
  recordDialogs,
  refocus,
} from "@/test/identity-change"
import { admin, anonymous, noRole, viewer } from "@/test/identities"
import { phoneViewport, pointerClick, renderBoard } from "@/test/render-board"
import { availabilityOn, interimDetails, interimServiceType } from "@/test/schedules"

import { calendarRange } from "./lib/calendar"

// The Calendar and who is signed in (Task 28b, after Task 27b's review round 1, ARCHITECTURE §15). A chip's details sheet
// holds the appointment as one caller read it, outside the query cache, so it closes in the same render as a change of
// identity; the writes the page starts (New appointment, a day's New appointment, cancelling from the sheet) are checked
// as they are sent, and an answer that arrives for a previous caller is thrown away, with no toast and no re-read of the
// range.

beforeAll(async () => {
  await Promise.all([import("@/app/calendar/page"), import("@/app/dispatch/page")])
})

beforeEach(() => {
  // Tuesday 2026-10-13, 09:30 in Reading (BST). Only Date is faked; timers stay real for the UI.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
  focusManager.setFocused(undefined)
})

const calendar = `/calendar?dealership=${reading.id}`
const interimChip = "Interim Service, Bay 1 - Standard, 08:00 to 09:00, Sophie Turner, Amelia Clarke, Confirmed"
const maskedInterimChip = "Interim Service, Bay 1 - Standard, 08:00 to 09:00, ST, Amelia Clarke, Confirmed"
const rangeReads = (requests: readonly Request[]) => requestsTo(requests, "/appointments").filter((request) => request.method === "GET")
const recordReads = (requests: readonly Request[]) => requestsTo(requests, `/api/v1/appointments/${interimDetails.id}`).length
const writes = (requests: readonly Request[]) => requests.filter((request) => request.method !== "GET")
const posts = (requests: readonly Request[], suffix: string) =>
  requests.filter((request) => request.method === "POST" && new URL(request.url).pathname.endsWith(suffix))
/** The week on screen (12 to 18 October), as the page builds its key. */
const weekKey = () => rangeReadOptions(reading.id, calendarRange("week", "2026-10-13").from, calendarRange("week", "2026-10-13").to).queryKey

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
    serviceTypes: () => [interimServiceType],
    availability: (_, __, date) => availabilityOn(date),
    ...options,
  })
}

/** Today's column, cell or agenda section, found by its heading (every open day of the fixtures has the same work). */
const tuesday = async () => (await screen.findByRole("heading", { level: 3, name: "Tuesday 13 October, today, dispatch board" })).closest("li")!

/** Opens Sophie Turner's Interim Service from Tuesday's chips (a phone's agenda card), once its whole record is on screen. */
async function openInterim() {
  fireEvent.click(await within(await tuesday()).findByRole("button", { name: interimChip }))
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

/** A New appointment's dialog, step 1 (Interim Service at 10:15) and step 2's customer and vehicle, ready for Book. */
async function enterBooking(newAppointment: string) {
  fireEvent.click(await screen.findByRole("button", { name: newAppointment }))
  const dialog = await screen.findByRole("dialog", { name: "Book appointment" })
  fireEvent.click(await within(dialog).findByRole("combobox", { name: "Service" }))
  pointerClick(await screen.findByRole("option", { name: /^Interim Service/ }))
  fireEvent.click(await within(dialog).findByRole("radio", { name: "10:15, 4 bays and 3 technicians free" }))
  fireEvent.click(within(dialog).getByRole("button", { name: "Next" }))
  await within(dialog).findByRole("heading", { name: "Customer and vehicle" })
  for (const [label, value] of Object.entries(customer)) fireEvent.change(within(dialog).getByRole("textbox", { name: label }), { target: { value } })
  return dialog
}

describe("a chip's details sheet when the identity changes", () => {
  it.each<[string, Caller, string | null]>([
    // What the sheet would show only for the next caller: it must never be drawn beside the booking's details.
    ["signs out", anonymous, "Sign in to see the whole booking"],
    ["becomes a Viewer", viewer, READ_ONLY_REASON],
    ["cannot be checked", "unreadable", "Sign in to see the whole booking"],
    ["loses every role", noRole, "Your account has no workshop role yet"],
    ["keeps the email with another writing role", { ...admin, roles: ["ServiceAdvisor"] }, null],
  ])("closes before it is drawn for the caller who %s, leaving nothing of the booking's chip or record", async (_, next, nextCallersView) => {
    let me: Caller = admin
    const { requests } = mockApiAs(() => me)
    const { queryClient } = renderBoard(calendar)
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
      // The calendar itself read again as the new caller: masked, as the API answers it, and the record was not asked for.
      expect(await within(await tuesday()).findByRole("button", { name: maskedInterimChip })).toBeInTheDocument()
      expectNothingPersonal(document.body.textContent, "the page")
      expect(recordReads(requests)).toBe(readsBefore)
    }
  })

  it("closes on a phone's agenda too, leaving focus in the page's content", async () => {
    phoneViewport()
    let me: Caller = admin
    mockApiAs(() => me)
    renderBoard(calendar)
    const sheet = await openInterim()

    me = anonymous
    refocus()

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Interim Service" })).not.toBeInTheDocument())
    expectNothingPersonal(sheet.textContent, "the closed sheet")
    await waitFor(() => expect(document.activeElement).not.toBe(document.body))
    expect(document.getElementById("content")?.contains(document.activeElement)).toBe(true)
    expect(await within(await tuesday()).findByRole("button", { name: maskedInterimChip })).toBeInTheDocument()
    expectNothingPersonal(document.body.textContent, "the page")
  })
})

describe("a booking being entered from a day when the identity changes", () => {
  it("is discarded with its customer and vehicle once the caller signs out", async () => {
    let me: Caller = admin
    mockApiAs(() => me)
    renderBoard(calendar)
    const dialog = await enterBooking("New appointment on Thursday 15 October")

    me = anonymous
    refocus()

    expect(await within(dialog).findByText(/The session changed: you’re signed out\./)).toBeInTheDocument()
    for (const field of within(dialog).queryAllByRole("textbox")) expect((field as HTMLInputElement).value).not.toMatch(/Draft|draft|DR22|WVWZZZ/)
    for (const value of Object.values(customer)) expect(dialog.textContent).not.toContain(value)
  })
})

describe.each<[string, CurrentUserResponse]>([
  ["signs out", anonymous],
  ["becomes a Viewer", viewer],
])("an answer that arrives after the caller %s", (_, next) => {
  it("to a day's New appointment is thrown away: no toast, nothing cached, and the range is not read again for it", async () => {
    let me: Caller = admin
    const answer = deferred<AppointmentResponse>()
    const api = mockApiAs(() => me, { book: () => answer.promise })
    const { queryClient } = renderBoard(calendar)
    const dialog = await enterBooking("New appointment on Thursday 15 October")
    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))
    await waitFor(() => expect(posts(api.requests, "/appointments")).toHaveLength(1))
    const body = await posts(api.requests, "/appointments")[0].clone().json()

    me = next
    refocus()
    await waitFor(() => expect(queryClient.getQueryData(currentUserQueryKey())).toEqual(next))
    // The week is read again once, as the new caller; then the late answer arrives.
    await waitFor(() => expect(queryClient.getQueryState(weekKey())?.status).toBe("success"))
    const rangeReadsBefore = rangeReads(api.requests).length
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    answer.release(bookedFrom(body))

    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryAllByText("Booked")).toHaveLength(0)
    expect(invalidate).not.toHaveBeenCalled()
    expect(rangeReads(api.requests)).toHaveLength(rangeReadsBefore)
    expect(cachedText(queryClient)).not.toContain("draft.private@example.invalid")
    expect(cachedText(queryClient)).not.toContain("Draft Private Customer")
  })

  it("to a cancellation from the sheet is thrown away: no toast, no record cached, and no range re-read", async () => {
    let me: Caller = admin
    const answer = deferred<AppointmentResponse>()
    const api = mockApiAs(() => me, { cancel: () => answer.promise })
    const { queryClient } = renderBoard(calendar)
    const sheet = await openInterim()
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Reason" }), { target: { value: "Customer rang" } })
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel appointment" }))
    await waitFor(() => expect(posts(api.requests, "/cancel")).toHaveLength(1))

    me = next
    refocus()
    await waitFor(() => expect(queryClient.getQueryData(currentUserQueryKey())).toEqual(next))
    await waitFor(() => expect(queryClient.getQueryState(weekKey())?.status).toBe("success"))
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

describe("a write from the Calendar, checked as it is sent", () => {
  it.each<[string, string, CurrentUserResponse]>([
    ["New appointment", "signed out", anonymous],
    ["New appointment", "a Viewer", viewer],
    ["New appointment on Thursday 15 October", "signed out", anonymous],
    ["New appointment on Thursday 15 October", "a Viewer", viewer],
  ])("sends no booking from %s once the identity in the cache is %s, before the view has drawn it", async (action, _, next) => {
    const api = mockApiAs(() => admin)
    const { queryClient } = renderBoard(calendar)
    const dialog = await enterBooking(action)

    // The new identity is in the cache and Book is pressed before React has rendered it: only the send can stop the write.
    queryClient.setQueryData(currentUserQueryKey(), next)
    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(posts(api.requests, "/appointments")).toHaveLength(0)
  })

  it("sends no cancellation from the sheet", async () => {
    const api = mockApiAs(() => admin)
    const { queryClient } = renderBoard(calendar)
    const sheet = await openInterim()
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Reason" }), { target: { value: "Customer rang" } })

    queryClient.setQueryData(currentUserQueryKey(), anonymous)
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel appointment" }))

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(posts(api.requests, "/cancel")).toHaveLength(0)
  })
})

describe("writes answered for the caller who sent them", () => {
  it("still read the week again: a booking from a day, then a cancellation from the sheet", async () => {
    const api = mockApiAs(() => admin)
    const { queryClient } = renderBoard(calendar)
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    const dialog = await enterBooking("New appointment on Thursday 15 October")
    let rangeReadsBefore = rangeReads(api.requests).length

    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))
    await screen.findByText("Booked")
    expect(invalidate).toHaveBeenCalledWith({ queryKey: rangeReadsOf(reading.id) })
    await waitFor(() => expect(rangeReads(api.requests).length).toBeGreaterThan(rangeReadsBefore))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Book appointment" })).not.toBeInTheDocument())

    invalidate.mockClear()
    rangeReadsBefore = rangeReads(api.requests).length
    const sheet = await openInterim()
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Reason" }), { target: { value: "Customer rang" } })
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel appointment" }))
    await screen.findByText("Appointment cancelled")
    expect(invalidate).toHaveBeenCalledWith({ queryKey: rangeReadsOf(reading.id) })
    await waitFor(() => expect(rangeReads(api.requests).length).toBeGreaterThan(rangeReadsBefore))
  })
})

describe("no gated request for a caller who may not make it", () => {
  it.each<[string, Caller]>([
    ["a visitor who is not signed in", anonymous],
    ["a Viewer", viewer],
    ["anyone while /me cannot be read", "unreadable"],
  ])("sends nothing for %s from New appointment, a day, or the sheet", async (_, me) => {
    const { requests } = mockApiAs(() => me)
    renderBoard(calendar)

    for (const action of ["New appointment", "New appointment on Thursday 15 October"]) {
      fireEvent.click(await screen.findByRole("button", { name: action }))
      if (!holdsRole(me)) {
        // Signed out, or nobody known: the sign-in prompt, which says when the check failed.
        const prompt = await screen.findByRole("dialog", { name: "Sign in to book" })
        if (me === "unreadable") expect(within(prompt).getByText(IDENTITY_CHECK_FAILED)).toBeInTheDocument()
        fireEvent.click(within(prompt).getByRole("button", { name: "Not now" }))
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sign in to book" })).not.toBeInTheDocument())
      }
      expect(screen.queryByRole("dialog", { name: "Book appointment" })).not.toBeInTheDocument()
    }

    fireEvent.click(await within(await tuesday()).findByRole("button", { name: holdsRole(me) ? interimChip : maskedInterimChip }))
    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    if (holdsRole(me)) {
      // A Viewer reads the record, and sees cancelling unavailable with the reason.
      expect(within(sheet).getByText(READ_ONLY_REASON)).toBeInTheDocument()
      fireEvent.click(within(sheet).getByRole("button", { name: "Cancel appointment" }))
    } else {
      expect(within(sheet).getByRole("region", { name: "Sign in to see the whole booking" })).toBeInTheDocument()
      expect(within(sheet).queryByRole("button", { name: "Cancel appointment" })).not.toBeInTheDocument()
    }

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(writes(requests)).toHaveLength(0)
    if (!holdsRole(me)) expect(recordReads(requests)).toBe(0)
  })
})
