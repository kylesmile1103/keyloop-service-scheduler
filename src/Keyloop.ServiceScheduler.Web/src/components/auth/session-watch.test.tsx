import { focusManager, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { CurrentUserResponse, WorkshopScheduleResponse } from "@/api/types.gen"
import { AppointmentSheet } from "@/app/dispatch/components/appointment-sheet"
import { boardAppointments } from "@/app/dispatch/lib/schedule"
import { createQueryClient } from "@/lib/query-client"
import { currentUserQueryKey } from "@/lib/session"
import { mockBoardApi, requestsTo } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { admin, anonymous, noRole, serviceAdvisor, viewer } from "@/test/identities"
import { problemResponse } from "@/test/mock-api"
import { phoneViewport, renderBoard } from "@/test/render-board"
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
    // The API's login path, coming back to this board rather than the API's "/".
    expect(signIn).toHaveAttribute("href", `/auth/login?returnTo=${encodeURIComponent(board)}`)
    await waitFor(() => expect(signIn).toHaveFocus())
    expect(within(dialog).getByText(traceId)).toBeInTheDocument()
    await waitFor(() => expect(meReads(api.requests)).toBeGreaterThan(before))
    // Nowhere the problem's raw JSON.
    expect(document.body.textContent).not.toContain(`${problems}unauthenticated`)
    expect(document.body.textContent).not.toContain('"status"')

    // /me now says signed out: the sheet, which showed the booking as the previous caller read it, has closed beneath.
    await waitFor(() => expect(sheet).not.toBeInTheDocument())
    expect(signIn).toHaveFocus()
    fireEvent.click(within(dialog).getByRole("button", { name: "Not now" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Your session has ended" })).not.toBeInTheDocument())
    // Opened again, it offers sign-in in place of the cancellation.
    fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
    const again = await screen.findByRole("dialog", { name: "Interim Service" })
    expect(within(again).getByRole("region", { name: "Sign in to see the whole booking" })).toBeInTheDocument()
    expect(within(again).queryByRole("textbox", { name: "Reason" })).not.toBeInTheDocument()
  })

  it.each([
    ["another origin", "https://evil.example/login?prompt=login&returnTo=%2F"],
    ["a protocol-relative address", "//evil.example/auth/login?returnTo=%2F"],
    ["another path on this origin", "/somewhere/else?returnTo=%2F"],
    ["a script URL", "javascript:alert(1)"],
    ["a malformed URL", "http://["],
  ])("signs in through this origin's /auth/login whatever a 401's loginUrl says (%s)", async (_, loginUrl) => {
    let me: CurrentUserResponse = serviceAdvisor
    mockBoardApi({
      me: () => me,
      cancel: () => {
        me = anonymous
        return problemResponse(401, { ...unauthenticated, loginUrl })
      },
    })
    renderBoard(board)
    await cancelInterim()

    const dialog = await sessionDialog("Your session has ended")
    expect(within(dialog).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/auth/login?returnTo=${encodeURIComponent(board)}`)
  })

  it("answers a 403 with what the role does not allow and who assigns roles, and reads /me again", async () => {
    const api = mockBoardApi({ me: () => serviceAdvisor, cancel: () => problemResponse(403, forbidden) })
    renderBoard(board)
    const sheet = await cancelInterim()
    const before = meReads(api.requests)

    const dialog = await sessionDialog("Your role doesn’t allow that")
    expect(within(dialog).getByText(/Roles are assigned by the workshop administrator\./)).toBeInTheDocument()
    expect(within(dialog).queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument()
    const close = within(dialog).getByRole("button", { name: "Close" })
    await waitFor(() => expect(close).toHaveFocus())
    await waitFor(() => expect(meReads(api.requests)).toBeGreaterThan(before))
    // /me names the same caller: the sheet stays, titling the refusal in its own words.
    expect(within(sheet).getByText("Couldn’t cancel the appointment: your role doesn’t allow it")).toBeInTheDocument()
    fireEvent.click(close)
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Your role doesn’t allow that" })).not.toBeInTheDocument())
    expect(sheet).toBeInTheDocument()
  })

  it("closes the sheet beneath a 403 when /me then names a role that cannot cancel, and shows why when it is opened again", async () => {
    let me: CurrentUserResponse = serviceAdvisor
    mockBoardApi({
      me: () => me,
      cancel: () => {
        me = viewer
        return problemResponse(403, forbidden)
      },
    })
    renderBoard(board)
    const sheet = await cancelInterim()

    const dialog = await sessionDialog("Your role doesn’t allow that")
    await waitFor(() => expect(sheet).not.toBeInTheDocument())
    expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus()
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Your role doesn’t allow that" })).not.toBeInTheDocument())

    fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
    const again = await screen.findByRole("dialog", { name: "Interim Service" })
    expect(within(again).getByText("Your role can view bookings but not change them.")).toBeInTheDocument()
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

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Interim Service" })).not.toBeInTheDocument())
    expect(screen.queryByRole("link", { name: "sophie.turner@example.com" })).not.toBeInTheDocument()
    // Settle the re-reads, then check none of them was the record.
    await waitFor(() => expect(screen.getAllByText("*******").length).toBeGreaterThan(0))
    expect(recordReads()).toBe(readsBefore)
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((query) => query.state.data))).not.toContain("sophie.turner@example.com")
  })

  it("keeps focus in the page's content when the sheet closes on a phone while the board reads its day again", async () => {
    phoneViewport()
    let me: CurrentUserResponse = admin
    mockBoardApi({ me: () => me, schedule: () => scheduleFor(me) })
    renderBoard(board)
    // The agenda's card names the customer too.
    fireEvent.click(await screen.findByRole("button", { name: "Interim Service, Bay 1 - Standard, 08:00 to 09:00, Sophie Turner, Amelia Clarke, Confirmed" }))
    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    await within(sheet).findByRole("link", { name: "sophie.turner@example.com" })

    me = anonymous
    refocus()

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Interim Service" })).not.toBeInTheDocument())
    // In the page's content (the board, or the content around it while the board reads its day again), not on the body or
    // the skip link at the top of the page.
    await waitFor(() => expect(document.activeElement).not.toBe(document.body))
    expect(document.getElementById("content")?.contains(document.activeElement)).toBe(true)
  })

  // The sheet alone, so what it came from can be made to be gone: on the board the fallback (the board itself) is usually
  // still there, so the case above passes with or without the sheet's own fallback to the page's content.
  it.each<[string, () => HTMLElement | null]>([
    ["an element no longer in the page", () => document.createElement("button")],
    ["nothing", () => null],
  ])("puts focus on the page's content when the sheet closes and what it came from is %s", async (_, returnFocus) => {
    mockBoardApi({ me: () => admin })
    const queryClient = createQueryClient()
    queryClient.setQueryData(currentUserQueryKey(), admin)
    const appointment = boardAppointments(readingTuesday)[0]
    const page = (shown: typeof appointment | null) => (
      <QueryClientProvider client={queryClient}>
        <button type="button">Outside the content</button>
        <div id="content" tabIndex={-1}>
          <p>The board, reading its day again</p>
          <AppointmentSheet
            appointment={shown}
            open={shown !== null}
            onOpenChange={() => {}}
            side="bottom"
            dealershipId={reading.id}
            date="2026-10-13"
            timeZone={reading.timeZoneId}
            returnFocus={returnFocus}
          />
        </div>
      </QueryClientProvider>
    )
    const { rerender } = render(page(null))
    // Focus was outside the content when the sheet opened, so falling back to it would not land in the content either.
    screen.getByRole("button", { name: "Outside the content" }).focus()
    rerender(page(appointment))
    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true))

    // The identity changed: the page drops its selection, and the sheet closes.
    rerender(page(null))

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Interim Service" })).not.toBeInTheDocument())
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById("content")))
  })

  it("does not read an open booking's record again when the window regains focus, before /me has answered", async () => {
    let me: CurrentUserResponse = serviceAdvisor
    const api = mockBoardApi({ me: () => me, schedule: () => scheduleFor(me) })
    renderBoard(board)
    fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    expect(await within(sheet).findByRole("link", { name: "sophie.turner@example.com" })).toBeInTheDocument()
    const recordReads = () => requestsTo(api.requests, `/appointments/${readingTuesday.bays[0].appointments[0].id}`).length
    const readsBefore = recordReads()

    // Long enough for every read on screen to be stale: the window's focus reads them all again, /me among them, and the
    // record would go out with the identity from before the sign-out.
    vi.setSystemTime(new Date("2026-10-13T08:31:00Z"))
    me = anonymous
    refocus()

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Interim Service" })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getAllByText("*******").length).toBeGreaterThan(0))
    expect(recordReads()).toBe(readsBefore)
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

/** Every personal field of the Interim Service booking, as the board, the list and its record show them to a role. */
const personalFields = [
  "Sophie Turner",
  "sophie.turner@example.com",
  "+44 7700 900105",
  "JTDKN3DU0A0123460",
  "RF20 BCJ",
  "Customer waiting in the lounge.",
  "Toyota Prius",
]

function expectNothingPersonal(text: string | null, where: string) {
  for (const field of personalFields) expect(text ?? "", `${field} in ${where}`).not.toContain(field)
}

/** Opens the Interim Service booking's details on the board (its block) or the list (its row's View details). */
async function openInterimDetails(page: string) {
  if (page === board) fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
  else {
    fireEvent.click(await screen.findByRole("button", { name: "Actions for Interim Service at 08:00, Sophie Turner" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "View details" }))
  }
  const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
  expect(await within(sheet).findByRole("link", { name: "sophie.turner@example.com" })).toBeInTheDocument()
  return sheet
}

describe.each([
  ["the board", board],
  ["the appointments list", list],
])("an open details sheet on %s when the identity changes", (_, page) => {
  it.each<[string, CurrentUserResponse | "unreadable"]>([
    ["signs out", anonymous],
    ["loses every role", noRole],
    ["cannot be checked", "unreadable"],
    ["is another account", viewer],
    ["keeps the email with another writing role", { ...admin, roles: ["ServiceAdvisor"] }],
  ])("closes when the caller %s, leaving nothing of the booking's snapshot or record", async (_, next) => {
    let me: CurrentUserResponse | "unreadable" = admin
    const roleHolder = () => me !== "unreadable" && me.authenticated && me.roles.length > 0
    mockBoardApi({
      me: () => (me === "unreadable" ? new Response("", { status: 502, statusText: "Bad Gateway" }) : me),
      schedule: () => (roleHolder() ? readingTuesday : masked(readingTuesday)),
    })
    const { queryClient } = renderBoard(page)
    const sheet = await openInterimDetails(page)

    me = next
    refocus()

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Interim Service" })).not.toBeInTheDocument())
    expectNothingPersonal(sheet.textContent, "the sheet")
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((query) => query.state.data))).not.toContain("sophie.turner@example.com")
    if (!roleHolder()) {
      // The page itself read again as the new caller: masked, as the API answers it.
      expect((await screen.findAllByText("*******")).length).toBeGreaterThan(0)
      expectNothingPersonal(document.body.textContent, "the page")
    }
  })
})
