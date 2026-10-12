import { focusManager } from "@tanstack/react-query"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { CurrentUserResponse } from "@/api/types.gen"
import { READ_ONLY_REASON } from "@/lib/session"
import { defaultSchedule, mockBoardApi, rangeFromSchedules, requestsTo } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { cachedText, expectNothingPersonal, maskedItem, maskedSchedule, recordDialogs, refocus } from "@/test/identity-change"
import { admin, anonymous, noRole, viewer } from "@/test/identities"
import { renderBoard } from "@/test/render-board"
import { interimDetails } from "@/test/schedules"

// The Overview and who is signed in (Task 28b, after Task 27b's review round 1, ARCHITECTURE §15). An upcoming row's
// details sheet holds the row as one caller read it, outside the query cache, so it closes in the same render as a change
// of identity.

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

