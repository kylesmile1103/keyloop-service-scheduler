import { focusManager } from "@tanstack/react-query"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { CurrentUserResponse } from "@/api/types.gen"
import { READ_ONLY_REASON } from "@/lib/session"
import { defaultSchedule, mockBoardApi, rangeFromSchedules, requestsTo } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { cachedText, expectNothingPersonal, maskedItem, maskedSchedule, recordDialogs, refocus } from "@/test/identity-change"
import { admin, anonymous, noRole, viewer } from "@/test/identities"
import { phoneViewport, renderBoard } from "@/test/render-board"
import { availabilityOn, interimDetails, interimServiceType } from "@/test/schedules"

// The Calendar and who is signed in (Task 28b, after Task 27b's review round 1, ARCHITECTURE §15). A chip's details sheet
// holds the appointment as one caller read it, outside the query cache, so it closes in the same render as a change of
// identity.

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
const recordReads = (requests: readonly Request[]) => requestsTo(requests, `/api/v1/appointments/${interimDetails.id}`).length

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

