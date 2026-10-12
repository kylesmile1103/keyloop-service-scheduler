import { focusManager } from "@tanstack/react-query"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { CurrentUserResponse, WorkshopScheduleResponse } from "@/api/types.gen"
import { mockBoardApi, requestsTo } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { anonymous, serviceAdvisor, viewer } from "@/test/identities"
import { problemResponse } from "@/test/mock-api"
import { renderBoard } from "@/test/render-board"
import { readingTuesday } from "@/test/schedules"

// The server's word on identity, answered in one place (Task 27b): 401 and 403 from any read or write, and the cache
// cleared when /me names another caller.

beforeAll(async () => {
  await Promise.all([import("@/app/dispatch/page"), import("@/app/appointments/page")])
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
  focusManager.setFocused(undefined)
})

const board = `/dispatch?dealership=${reading.id}`
const list = `/appointments?dealership=${reading.id}`
const interimLabel = "Interim Service, Bay 1 - Standard, 08:00 to 09:00, Amelia Clarke, Confirmed"
const traceId = "00-7d1c2b3a4f5e6d7c8b9a0f1e2d3c4b5a-1a2b3c4d5e6f7a8b-01"
const problems = "https://api.keyloop.example/problems/"

const unauthenticated = {
  type: `${problems}unauthenticated`,
  title: "Authentication required",
  status: 401,
  detail: "Sign in to perform this action.",
  traceId,
  loginUrl: "/auth/login?returnTo=%2F",
}
const forbidden = { type: `${problems}forbidden`, title: "Forbidden", status: 403, detail: "Your role does not permit this action.", traceId }

/** The schedule as the API answers a caller without a role: initials, the VIN's last six, the plate fully masked. */
function masked(schedule: WorkshopScheduleResponse): WorkshopScheduleResponse {
  const initials = (name: string) => name.split(/\s+/).map((part) => part.charAt(0).toUpperCase()).join("")
  return {
    ...schedule,
    bays: schedule.bays.map((bay) => ({
      ...bay,
      appointments: bay.appointments.map((appointment) => ({
        ...appointment,
        customerName: initials(appointment.customerName),
        vin: `***********${appointment.vin.slice(-6)}`,
        registration: "*******",
      })),
    })),
  }
}

/** The schedule each caller is shown, as the API decides it. */
const scheduleFor = (me: CurrentUserResponse) => (me.authenticated && me.roles.length > 0 ? readingTuesday : masked(readingTuesday))

function refocus() {
  act(() => {
    focusManager.setFocused(false)
    focusManager.setFocused(true)
  })
}

const meReads = (requests: readonly Request[]) => requestsTo(requests, "/api/v1/me").length
const sessionDialog = (name: string) => screen.findByRole("dialog", { name })

async function cancelInterim(reason = "Customer rang to rearrange") {
  fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
  const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
  fireEvent.change(within(sheet).getByRole("textbox", { name: "Reason" }), { target: { value: reason } })
  fireEvent.click(within(sheet).getByRole("button", { name: "Cancel appointment" }))
  return sheet
}

describe("a 401 or 403 from the server", () => {
  it("answers a refused write's 401 with Your session has ended, signing in back to this page, and reads /me again", async () => {
    let me: CurrentUserResponse = serviceAdvisor
    const api = mockBoardApi({
      me: () => me,
      cancel: () => {
        // The session ended on the server: from now on /me says so too.
        me = anonymous
        return problemResponse(401, unauthenticated)
      },
    })
    renderBoard(board)
    const sheet = await cancelInterim()
    const before = meReads(api.requests)

    const dialog = await sessionDialog("Your session has ended")
    expect(within(dialog).getByText(/Anything not yet saved on this page, such as a booking being entered, will need entering again\./)).toBeInTheDocument()
    const signIn = within(dialog).getByRole("link", { name: "Sign in" })
    // The problem's own login URL, coming back to this board rather than the API's "/".
    expect(signIn).toHaveAttribute("href", `/auth/login?returnTo=${encodeURIComponent(board)}`)
    await waitFor(() => expect(signIn).toHaveFocus())
    expect(within(dialog).getByText(traceId)).toBeInTheDocument()
    await waitFor(() => expect(meReads(api.requests)).toBeGreaterThan(before))
    // Nowhere the problem's raw JSON.
    expect(document.body.textContent).not.toContain(`${problems}unauthenticated`)
    expect(document.body.textContent).not.toContain('"status"')

    fireEvent.click(within(dialog).getByRole("button", { name: "Not now" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Your session has ended" })).not.toBeInTheDocument())
    // /me now says signed out: the sheet offers sign-in in place of the cancellation.
    expect(await within(sheet).findByRole("region", { name: "Sign in to see the whole booking" })).toBeInTheDocument()
    expect(within(sheet).queryByRole("textbox", { name: "Reason" })).not.toBeInTheDocument()
  })

  it("answers a 403 with what the role does not allow and who assigns roles, and reads /me again", async () => {
    let me: CurrentUserResponse = serviceAdvisor
    const api = mockBoardApi({
      me: () => me,
      cancel: () => {
        me = viewer
        return problemResponse(403, forbidden)
      },
    })
    renderBoard(board)
    const sheet = await cancelInterim()
    const before = meReads(api.requests)

    const dialog = await sessionDialog("Your role doesn’t allow that")
    expect(within(dialog).getByText(/Roles are assigned by the workshop administrator\./)).toBeInTheDocument()
    expect(within(dialog).queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument()
    const close = within(dialog).getByRole("button", { name: "Close" })
    await waitFor(() => expect(close).toHaveFocus())
    await waitFor(() => expect(meReads(api.requests)).toBeGreaterThan(before))
    expect(within(sheet).getByText("Couldn’t cancel the appointment: your role doesn’t allow it")).toBeInTheDocument()

    fireEvent.click(close)
    // /me now says Viewer: the sheet shows the action unavailable, with the reason.
    expect(await within(sheet).findByText("Your role can view bookings but not change them.")).toBeInTheDocument()
  })

  it("answers a refused read too", async () => {
    let me: CurrentUserResponse = viewer
    mockBoardApi({
      me: () => me,
      appointment: () => {
        me = anonymous
        return problemResponse(401, unauthenticated)
      },
    })
    renderBoard(board)

    fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
    expect(await sessionDialog("Your session has ended")).toBeInTheDocument()
  })

  it("says Sign in to continue when nobody was signed in, and answers a burst of refusals once", async () => {
    mockBoardApi({ me: () => anonymous, schedule: () => problemResponse(401, unauthenticated), availability: () => problemResponse(401, unauthenticated) })
    renderBoard(board)

    expect(await sessionDialog("Sign in to continue")).toBeInTheDocument()
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
  })
})

describe("a change of identity", () => {
  it("clears the previous caller's full names from the cache and the screen, then reads the list again as the new one", async () => {
    let me: CurrentUserResponse = serviceAdvisor
    const api = mockBoardApi({ me: () => me, schedule: () => scheduleFor(me) })
    const { queryClient } = renderBoard(list)

    expect(await screen.findByText("Sophie Turner")).toBeInTheDocument()
    const schedulesBefore = requestsTo(api.requests, "/schedule").length

    // Signed out in another tab; this one notices when its window regains focus.
    me = anonymous
    refocus()

    expect(await screen.findByText("ST")).toBeInTheDocument()
    expect(screen.queryByText("Sophie Turner")).not.toBeInTheDocument()
    expect(requestsTo(api.requests, "/schedule").length).toBeGreaterThan(schedulesBefore)
    const cached = JSON.stringify(queryClient.getQueryCache().getAll().map((query) => query.state.data))
    expect(cached).not.toContain("Sophie Turner")
    expect(cached).not.toContain("RF20 BCJ")
  })

  it("takes an open booking's record off the screen and never asks for it as the visitor", async () => {
    let me: CurrentUserResponse = serviceAdvisor
    const api = mockBoardApi({ me: () => me, schedule: () => scheduleFor(me) })
    const { queryClient } = renderBoard(board)

    fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    expect(await within(sheet).findByRole("link", { name: "sophie.turner@example.com" })).toBeInTheDocument()
    const recordReads = () => requestsTo(api.requests, `/appointments/${readingTuesday.bays[0].appointments[0].id}`).length
    const readsBefore = recordReads()

    me = anonymous
    refocus()

    expect(await within(sheet).findByRole("region", { name: "Sign in to see the whole booking" })).toBeInTheDocument()
    expect(within(sheet).queryByRole("link", { name: "sophie.turner@example.com" })).not.toBeInTheDocument()
    // Settle the re-reads, then check none of them was the record.
    await waitFor(() => expect(screen.getAllByText("*******").length).toBeGreaterThan(0))
    expect(recordReads()).toBe(readsBefore)
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((query) => query.state.data))).not.toContain("sophie.turner@example.com")
  })

  it("keeps the board as it is when /me answers again with the same caller", async () => {
    const api = mockBoardApi({ me: () => serviceAdvisor })
    renderBoard(list)
    expect(await screen.findByText("Sophie Turner")).toBeInTheDocument()
    const schedules = requestsTo(api.requests, "/schedule").length

    refocus()

    await waitFor(() => expect(requestsTo(api.requests, "/api/v1/me").length).toBeGreaterThan(1))
    expect(screen.getByText("Sophie Turner")).toBeInTheDocument()
    // Only the list's own focus re-read (it reads again on focus when stale), never a reset.
    expect(requestsTo(api.requests, "/schedule").length - schedules).toBeLessThanOrEqual(1)
  })
})
