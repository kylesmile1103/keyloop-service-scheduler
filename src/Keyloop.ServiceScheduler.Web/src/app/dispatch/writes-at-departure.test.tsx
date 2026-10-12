import type { QueryClient } from "@tanstack/react-query"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest"

import type { CurrentUserResponse } from "@/api/types.gen"
import { client } from "@/lib/api-client"
import { rangeReadsOf } from "@/lib/appointment-range"
import { currentUserQueryKey } from "@/lib/session"
import { clearCallerData } from "@/lib/session-cache"
import { bookedFrom, mockBoardApi } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { admin, anonymous, viewer } from "@/test/identities"
import { problemResponse } from "@/test/mock-api"
import { pointerClick, renderBoard } from "@/test/render-board"
import { availabilityOn, interimServiceType } from "@/test/schedules"
import { brakesServiceType, triageAnswer, triageEnabled, triageUnavailable } from "@/test/triage"
import { vehicleAwareOff, vehicleAwareOn } from "@/test/vehicle"

// Review round 3: a write's account is checked at the last moment it can be, inside the fetch the generated client calls
// for each of the write's requests, once the client's own awaited preparation (its auth parameters, its request
// interceptors) is done and immediately before the request is forwarded. Round 2 checked before that preparation, so an
// identity that changed while the client prepared the request was not seen: the previous account's booking, cancellation,
// description or photo left as the next caller.
//
// These tests use the app's own generated client, unmodified, with its real awaits. The identity changes in a microtask
// queued from a request interceptor on that client, so it lands while the client awaits its interceptors: after the write
// has started (and passed the check at its start), before the client calls fetch. Each test checks that it did land
// there: the client had built the request, and no request of that kind had reached fetch yet.
//
// The Overview and the Calendar (Task 28b) write through the board's booking dialog and details sheet, so their rows are the
// same writes started from those pages: Book appointment and an upcoming row's sheet on the Overview, a day's New
// appointment and a chip's sheet on the Calendar. Every row also checks the range reads those pages show: a write stopped
// before its request left marks none of them stale, and a booking or cancellation whose answer is used marks them all.

beforeAll(async () => {
  await Promise.all([import("@/app/dispatch/page"), import("@/app/overview/page"), import("@/app/calendar/page")])
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
})

const board = `/dispatch?dealership=${reading.id}`
const overview = `/overview?dealership=${reading.id}`
const calendar = `/calendar?dealership=${reading.id}`
const interimLabel = "Interim Service, Bay 1 - Standard, 08:00 to 09:00, Amelia Clarke, Confirmed"
const imageId = "550e8400-e29b-41d4-a716-446655440000"

const posts = (requests: readonly Request[], suffix: string) =>
  requests.filter((request) => request.method === "POST" && new URL(request.url).pathname.endsWith(suffix))

/** Everything the cache holds: every query's data and every mutation's state (its variables, data and error). */
function cached(queryClient: QueryClient): string {
  return JSON.stringify({
    queries: queryClient.getQueryCache().getAll().map((query) => query.state.data),
    mutations: queryClient.getMutationCache().getAll().map((mutation) => mutation.state),
  })
}

/** Lets the send, its answer and TanStack's notifications all run. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 150)))

const customer = {
  Name: "Draft Private Customer",
  Email: "draft.private@example.invalid",
  Phone: "+44 7700 900777",
  VIN: "WVWZZZ1KZAW654321",
  Registration: "DR22 AFT",
  Make: "Volkswagen",
  Model: "Golf",
}
const reason = "Private previous-account reason"
const description = "Private previous-account description"

/** Another account that may book and cancel: the same role as `admin`, another email. */
const otherAdmin: CurrentUserResponse = { ...admin, email: "another.admin@keyloop.test", displayName: "Another Admin" }

/** The same email with another role that may book: the same writer. */
const sameEmailAdvisor: CurrentUserResponse = { ...admin, roles: ["ServiceAdvisor"] }

const slotUnavailable = {
  type: "https://api.keyloop.example/problems/slot-unavailable",
  title: "Slot unavailable",
  status: 409,
  detail: "Every qualified bay or technician is busy at 10:15.",
  suggestedSlots: [{ startUtc: "2026-10-13T09:30:00Z", endUtc: "2026-10-13T10:30:00Z", startLocal: "2026-10-13T10:30+01:00" }],
}

/** What the API answers `/me` with, and whether that read fails: what the change of identity also tells the API mock. */
interface Session {
  me: CurrentUserResponse
  meFails: boolean
}

/** A change of who is signed in, made at once in the app's query cache, as `/me`'s answer (or its failure) makes it. */
interface Change {
  name: string
  apply: (queryClient: QueryClient, session: Session) => void
}

const becomes = (name: string, next: CurrentUserResponse): Change => ({
  name,
  apply: (queryClient, session) => {
    session.me = next
    queryClient.setQueryData(currentUserQueryKey(), next)
  },
})

/**
 * A `/me` re-read that failed: nobody is known until it answers again. The query's final failed state, with the cleanup
 * SessionWatch makes on a failure (it clears on the first failed attempt; the failed state itself cannot be dispatched
 * from outside TanStack in one step).
 */
const meFails: Change = {
  name: "cannot be read (/me failed)",
  apply: (queryClient, session) => {
    session.meFails = true
    queryClient.getQueryCache().find({ queryKey: currentUserQueryKey() })!.setState({
      status: "error",
      fetchStatus: "idle",
      fetchFailureCount: 1,
      error: new Error("/me could not be read"),
    })
    clearCallerData(queryClient)
  },
}

/**
 * Changes who is signed in while the generated client prepares the `nth` POST to `path` from now on: in a microtask queued
 * from a request interceptor on the app's client, so the change lands while the client awaits its interceptors. Records
 * how many POSTs to `path` had been sent before (`before`), how many the client prepared since (`prepared`), and how many
 * had reached fetch when the change landed (`reachedFetch`).
 */
function changeWhilePreparing(api: { requests: Request[] }, queryClient: QueryClient, session: Session, path: string, nth: number, change: Change) {
  const at = { before: posts(api.requests, path).length, prepared: 0, reachedFetch: -1 }
  const interceptor = (request: Request) => {
    if (request.method === "POST" && new URL(request.url).pathname.endsWith(path) && ++at.prepared === nth) {
      at.reachedFetch = posts(api.requests, path).length
      queueMicrotask(() => change.apply(queryClient, session))
    }
    return request
  }
  client.interceptors.request.use(interceptor)
  onTestFinished(() => client.interceptors.request.eject(interceptor))
  return at
}

/** Opens the booking dialog from a page's Book action (the board's and the Overview's Book appointment, a Calendar day's New appointment). */
async function openBooking(action = "Book appointment") {
  const control = await screen.findByRole("button", { name: action })
  await waitFor(() => expect(control).not.toHaveAttribute("aria-disabled", "true"))
  fireEvent.click(control)
  return screen.findByRole("dialog", { name: "Book appointment" })
}

/** Opens Sophie Turner's Interim Service from `row` (a Calendar chip, an upcoming row) and types a reason, ready to cancel. */
async function cancelFrom(row: () => Promise<HTMLElement>) {
  fireEvent.click(await row())
  const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
  await within(sheet).findByRole("link", { name: "sophie.turner@example.com" })
  fireEvent.change(within(sheet).getByRole("textbox", { name: "Reason" }), { target: { value: reason } })
  return () => fireEvent.click(within(sheet).getByRole("button", { name: "Cancel appointment" }))
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

const photo = (name: string) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" })

/**
 * One way a write is sent: the POST whose preparation the change lands in (`path`, the `nth` of them the press sends), how
 * the view is brought to the press that sends it (returning that press), what it carries that must then be nowhere, and
 * the sign that its answer was used.
 */
interface WritePath {
  name: string
  /** The page the write is made from: the board unless given. */
  page?: string
  /** The time the page is opened at, when not Tuesday 09:30 (the Overview lists upcoming work from 07:30). */
  now?: string
  path: string
  nth: number
  /** Answers the first attempt with a failure, so the second is the one under test (Try again, a suggested start). */
  firstFails?: "book-503" | "book-409" | "triage-503"
  photos?: number
  /**
   * A later request of a write whose first request already left: a write's requests all leave as one caller, so even a
   * change between two roles that may write for the same email stops it (what the first answered was the previous
   * caller's).
   */
  later?: true
  /** Needs vehicle-aware requirements on (the VIN look-up, Task 31b). */
  vehicleAware?: true
  open: () => Promise<() => void>
  carries: string[]
  answered: () => Promise<unknown>
}

const bookingDetails = [customer.Name, customer.Email, customer.Phone, customer.VIN, customer.Registration]

async function describeIssue(photos: number) {
  const dialog = await openBooking()
  if (photos > 0) {
    const files = Array.from({ length: photos }, (_, index) => photo(`private-${index + 1}.png`))
    fireEvent.change(within(dialog).getByLabelText("Photos or paperwork (optional)"), { target: { files } })
  }
  fireEvent.change(await within(dialog).findByRole("textbox", { name: "Describe the issue" }), { target: { value: description } })
  return dialog
}

const suggestionsShown = () => screen.findByRole("radiogroup", { name: "Suggested services" })

const writePaths: WritePath[] = [
  {
    name: "Book",
    path: "/appointments",
    nth: 1,
    open: async () => {
      const dialog = await openBooking()
      await enterBooking(dialog)
      return () => fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))
    },
    carries: bookingDetails,
    answered: () => screen.findByText("Booked"),
  },
  {
    name: "Book's Try again",
    path: "/appointments",
    nth: 1,
    firstFails: "book-503",
    open: async () => {
      const dialog = await openBooking()
      await enterBooking(dialog)
      fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))
      const retry = within(await within(dialog).findByRole("alert")).getByRole("button", { name: "Try again" })
      return () => fireEvent.click(retry)
    },
    carries: bookingDetails,
    answered: () => screen.findByText("Booked"),
  },
  {
    name: "a suggested start (Book at 10:30 instead)",
    path: "/appointments",
    nth: 1,
    firstFails: "book-409",
    open: async () => {
      const dialog = await openBooking()
      await enterBooking(dialog)
      fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))
      const chip = within(await within(dialog).findByRole("alert")).getByRole("button", { name: "Book at 10:30 instead" })
      return () => fireEvent.click(chip)
    },
    carries: bookingDetails,
    answered: () => screen.findByText("Booked"),
  },
  {
    // Task 31b: the VIN look-up is a BookingsWrite like Book, its VIN in the body only.
    name: "Look up (the VIN's manufacturer)",
    path: "/vehicle-profiles/resolve",
    nth: 1,
    vehicleAware: true,
    open: async () => {
      const dialog = await openBooking()
      await enterBooking(dialog)
      return () => fireEvent.click(within(dialog).getByRole("button", { name: "Look up" }))
    },
    carries: [customer.VIN],
    answered: () => screen.findByText("VOLKSWAGEN"),
  },
  {
    name: "Cancel appointment",
    path: "/cancel",
    nth: 1,
    open: async () => {
      fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
      const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
      await within(sheet).findByRole("link", { name: "sophie.turner@example.com" })
      fireEvent.change(within(sheet).getByRole("textbox", { name: "Reason" }), { target: { value: reason } })
      return () => fireEvent.click(within(sheet).getByRole("button", { name: "Cancel appointment" }))
    },
    carries: [reason],
    answered: () => screen.findByText("Appointment cancelled"),
  },
  {
    name: "Book appointment on the Overview",
    page: overview,
    now: "2026-10-13T06:30:00Z",
    path: "/appointments",
    nth: 1,
    open: async () => {
      await screen.findByRole("region", { name: "Bookings per day" })
      const dialog = await openBooking()
      await enterBooking(dialog)
      return () => fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))
    },
    carries: bookingDetails,
    answered: () => screen.findByText("Booked"),
  },
  {
    name: "Cancel appointment from an upcoming row on the Overview",
    page: overview,
    now: "2026-10-13T06:30:00Z",
    path: "/cancel",
    nth: 1,
    open: () =>
      cancelFrom(async () =>
        within(await screen.findByRole("region", { name: "Upcoming appointments" })).findByRole("button", {
          name: "Today, Interim Service, Bay 1 - Standard, 08:00 to 09:00, Sophie Turner, Amelia Clarke, Confirmed",
        })
      ),
    carries: [reason],
    answered: () => screen.findByText("Appointment cancelled"),
  },
  {
    name: "New appointment on a Calendar day",
    page: calendar,
    path: "/appointments",
    nth: 1,
    open: async () => {
      const dialog = await openBooking("New appointment on Thursday 15 October")
      await enterBooking(dialog)
      return () => fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))
    },
    carries: bookingDetails,
    answered: () => screen.findByText("Booked"),
  },
  {
    name: "Cancel appointment from a chip on the Calendar",
    page: calendar,
    path: "/cancel",
    nth: 1,
    open: () =>
      cancelFrom(async () => {
        const tuesday = (await screen.findByRole("heading", { level: 3, name: "Tuesday 13 October, today, dispatch board" })).closest("li")!
        return within(tuesday).findByRole("button", { name: "Interim Service, Bay 1 - Standard, 08:00 to 09:00, Sophie Turner, Amelia Clarke, Confirmed" })
      }),
    carries: [reason],
    answered: () => screen.findByText("Appointment cancelled"),
  },
  {
    name: "Suggest a service",
    path: "/booking-triage",
    nth: 1,
    open: async () => {
      const dialog = await describeIssue(0)
      return () => fireEvent.click(within(dialog).getByRole("button", { name: "Suggest a service" }))
    },
    carries: [description],
    answered: suggestionsShown,
  },
  {
    name: "the suggestions' Try again",
    path: "/booking-triage",
    nth: 1,
    firstFails: "triage-503",
    open: async () => {
      const dialog = await describeIssue(0)
      fireEvent.click(within(dialog).getByRole("button", { name: "Suggest a service" }))
      const retry = await within(dialog).findByRole("button", { name: "Try again" })
      return () => fireEvent.click(retry)
    },
    carries: [description],
    answered: suggestionsShown,
  },
  {
    name: "a photo's upload",
    path: "/booking-triage/images",
    nth: 1,
    photos: 1,
    open: async () => {
      const dialog = await describeIssue(1)
      return () => fireEvent.click(within(dialog).getByRole("button", { name: "Suggest a service" }))
    },
    carries: [description, "iVBORw=="],
    answered: suggestionsShown,
  },
  {
    name: "the second photo's upload",
    path: "/booking-triage/images",
    nth: 2,
    photos: 2,
    later: true,
    open: async () => {
      const dialog = await describeIssue(2)
      return () => fireEvent.click(within(dialog).getByRole("button", { name: "Suggest a service" }))
    },
    carries: [description],
    answered: suggestionsShown,
  },
  {
    name: "the suggestion sent after its photo's upload",
    path: "/booking-triage",
    nth: 1,
    photos: 1,
    later: true,
    open: async () => {
      const dialog = await describeIssue(1)
      return () => fireEvent.click(within(dialog).getByRole("button", { name: "Suggest a service" }))
    },
    carries: [description, imageId],
    answered: suggestionsShown,
  },
]

/** The board's API for every path: the first attempt fails when the path asks for it, every later one succeeds. */
function boardApi(session: Session, write: WritePath) {
  let books = 0
  let suggestions = 0
  return mockBoardApi({
    me: () => (session.meFails ? problemResponse(500, { type: "about:blank", title: "Internal Server Error", status: 500 }) : session.me),
    serviceTypes: () => [interimServiceType, brakesServiceType],
    availability: (_, __, date) => availabilityOn(date),
    triageStatus: () => triageEnabled,
    features: () => (write.vehicleAware ? vehicleAwareOn : vehicleAwareOff),
    book: (_, body) => {
      books++
      if (books === 1 && write.firstFails === "book-503") return new Response("", { status: 503, statusText: "Service Unavailable" })
      if (books === 1 && write.firstFails === "book-409") return problemResponse(409, slotUnavailable)
      return bookedFrom(body)
    },
    uploadTriageImage: () => ({ imageId, contentType: "image/png", sizeBytes: 4, expiresAt: "2026-10-13T09:30:00Z" }),
    triage: () => {
      suggestions++
      if (suggestions === 1 && write.firstFails === "triage-503") return problemResponse(503, triageUnavailable)
      return triageAnswer("suggest", [[brakesServiceType, 0.95]])
    },
  })
}

/** Opens the write's page as it is made from there, at its time. */
function renderPage(write: WritePath) {
  if (write.now) vi.setSystemTime(new Date(write.now))
  return renderBoard(write.page ?? board)
}

/** Whether the write's answer, once used, marks the dealership's range reads stale (a booking or a cancellation does). */
const marksRanges = (write: WritePath) => write.path === "/appointments" || write.path === "/cancel"

describe.each(writePaths)("$name, while the generated client prepares its request", (write) => {
  it.each<Change>([
    becomes("signs out", anonymous),
    becomes("becomes a Viewer", viewer),
    meFails,
    becomes("is another account that may write", otherAdmin),
  ])("sends nothing when who is signed in $name, and keeps nothing of it", async (change) => {
    const session: Session = { me: admin, meFails: false }
    const api = boardApi(session, write)
    const { queryClient } = renderPage(write)
    const press = await write.open()

    const at = changeWhilePreparing(api, queryClient, session, write.path, write.nth, change)
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    press()
    await settle()

    // The change landed inside the client's preparation of this request: built, not yet given to fetch.
    expect(at.prepared).toBe(write.nth)
    expect(at.reachedFetch).toBe(at.before + write.nth - 1)
    // Nothing more left, for anyone.
    expect(posts(api.requests, write.path)).toHaveLength(at.before + write.nth - 1)
    if (write.path === "/booking-triage/images") expect(posts(api.requests, "/booking-triage")).toHaveLength(0)
    // No toast or other effect, and nothing of it kept anywhere.
    expect(screen.queryAllByText("Booked")).toHaveLength(0)
    expect(screen.queryAllByText("Appointment cancelled")).toHaveLength(0)
    expect(screen.queryByRole("radiogroup", { name: "Suggested services" })).not.toBeInTheDocument()
    expect(screen.queryAllByText("VOLKSWAGEN")).toHaveLength(0)
    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
    for (const value of write.carries) expect(cached(queryClient)).not.toContain(value)
    // A write stopped before its request left has no answer: no range read is marked stale for it.
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: rangeReadsOf(reading.id) })
  })

  if (write.later) {
    it("is not sent when the same email changes to another role after the write's first request left", async () => {
      const session: Session = { me: admin, meFails: false }
      const api = boardApi(session, write)
      const { queryClient } = renderPage(write)
      const press = await write.open()

      const at = changeWhilePreparing(api, queryClient, session, write.path, write.nth, becomes("same email", sameEmailAdvisor))
      press()
      await settle()

      expect(at.reachedFetch).toBe(at.before + write.nth - 1)
      expect(posts(api.requests, write.path)).toHaveLength(at.before + write.nth - 1)
      expect(posts(api.requests, "/booking-triage")).toHaveLength(0)
      expect(screen.queryByRole("radiogroup", { name: "Suggested services" })).not.toBeInTheDocument()
      await waitFor(() => expect(queryClient.isMutating()).toBe(0))
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
      for (const value of write.carries) expect(cached(queryClient)).not.toContain(value)
    })
  } else {
    it("is still sent, once, and its answer used, when the same email changes to another role that may write", async () => {
      const session: Session = { me: admin, meFails: false }
      const api = boardApi(session, write)
      const { queryClient } = renderPage(write)
      const press = await write.open()

      const at = changeWhilePreparing(api, queryClient, session, write.path, write.nth, becomes("same email", sameEmailAdvisor))
      const invalidate = vi.spyOn(queryClient, "invalidateQueries")
      press()

      expect(await write.answered()).toBeInTheDocument()
      await settle()
      expect(at.reachedFetch).toBe(at.before + write.nth - 1)
      expect(posts(api.requests, write.path)).toHaveLength(at.before + (write.path === "/booking-triage/images" ? write.photos! : 1))
      // The answer is the caller's: a booking or a cancellation marks every range read of the dealership stale.
      if (marksRanges(write)) expect(invalidate).toHaveBeenCalledWith({ queryKey: rangeReadsOf(reading.id) })
      else expect(invalidate).not.toHaveBeenCalledWith({ queryKey: rangeReadsOf(reading.id) })
    })
  }
})

/**
 * The checker's own probe, unmodified (`sdk-unmodified.test.tsx`): no interceptor added, the identity changes a given
 * number of microtasks after TanStack marks the write pending, across the generated client's existing awaits. Whatever the
 * depth: if no request had reached fetch when another account entered the cache, none is sent afterwards; if one had, it is
 * not recalled. Both must happen across the sweep, so it spans the moment the request leaves.
 */
describe.each([
  { name: "Book", path: "/appointments" },
  { name: "Cancel appointment", path: "/cancel" },
])("$name, with another account entering the cache a few microtasks after the write starts", ({ name, path }) => {
  it("is sent only if its request had reached fetch before the change, at every depth", { timeout: 60_000 }, async () => {
    const outcomes: Array<{ depth: number; reachedFetch: number; sent: number }> = []
    for (let depth = 0; depth < 12; depth++) {
      const session: Session = { me: admin, meFails: false }
      const write = writePaths.find((candidate) => candidate.name === name)!
      const api = boardApi(session, write)
      const { queryClient } = renderBoard(board)
      const press = await write.open()
      let reachedFetch = -1
      const stop = queryClient.getMutationCache().subscribe((event) => {
        if (event.type !== "updated" || event.action.type !== "pending") return
        const change = () => {
          reachedFetch = posts(api.requests, path).length
          becomes("another account", otherAdmin).apply(queryClient, session)
        }
        const later = (left: number) => queueMicrotask(() => (left > 0 ? later(left - 1) : change()))
        later(depth)
      })
      press()
      await settle()
      stop()
      outcomes.push({ depth, reachedFetch, sent: posts(api.requests, path).length })
      cleanup()
    }

    for (const outcome of outcomes) expect(outcome).toEqual({ ...outcome, sent: outcome.reachedFetch })
    expect(outcomes.some((outcome) => outcome.reachedFetch === 0)).toBe(true)
    expect(outcomes.some((outcome) => outcome.reachedFetch === 1)).toBe(true)
  })
})
