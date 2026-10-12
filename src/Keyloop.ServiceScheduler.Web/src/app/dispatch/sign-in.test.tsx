import { focusManager } from "@tanstack/react-query"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { CurrentUserResponse, WorkshopScheduleResponse } from "@/api/types.gen"
import { NO_ROLE_REASON, READ_ONLY_REASON } from "@/lib/session"
import { mockBoardApi, requestsTo } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { expectAvailable, expectUnavailableButFocusable } from "@/test/focus"
import { admin, anonymous, noRole, serviceAdvisor, viewer } from "@/test/identities"
import { phoneViewport, pointerClick, renderBoard } from "@/test/render-board"
import { interimServiceType, readingTuesday } from "@/test/schedules"
import { triageEnabled } from "@/test/triage"

// What the dispatch board offers each role before a request is made (Task 27b, UI_DESIGN 11.20): a visitor who is not
// signed in is asked to sign in, a role that cannot book sees why, and Admin and Service advisor book as before.

beforeAll(async () => {
  await Promise.all([import("@/app/dispatch/page"), import("@/app/settings/account/page")])
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

const board = `/dispatch?dealership=${reading.id}`
const interimLabel = "Interim Service, Bay 1 - Standard, 08:00 to 09:00, Amelia Clarke, Confirmed"
const bookButton = () => screen.findByRole("button", { name: "Book appointment" })
const writes = (requests: readonly Request[]) => requests.filter((request) => request.method !== "GET")

/** Reading's Tuesday with nothing booked: the empty board offers its own Book appointment. */
const emptyTuesday: WorkshopScheduleResponse = {
  ...readingTuesday,
  bays: readingTuesday.bays.map((bay) => ({ ...bay, appointments: [] })),
}

/** The window regaining focus, which reads `/me` again (another tab may have signed in or out). */
function refocus() {
  act(() => {
    focusManager.setFocused(false)
    focusManager.setFocused(true)
  })
}

describe("booking as a visitor who is not signed in", () => {
  it("asks to sign in instead of opening the booking dialog, and sends nothing", async () => {
    const { requests } = mockBoardApi({ me: () => anonymous })
    renderBoard(`${board}&date=2026-10-14`)

    const book = await bookButton()
    expectAvailable(book)
    fireEvent.click(book)

    const prompt = await screen.findByRole("dialog", { name: "Sign in to book" })
    expect(within(prompt).getByRole("img", { name: "Calendar booking card beside a car key." })).toBeInTheDocument()
    expect(within(prompt).getByText(/Booking needs a workshop account with the Admin or Service advisor role\./)).toBeInTheDocument()
    // Sign in takes focus, and comes back to this board, its dealership and its day.
    const signIn = within(prompt).getByRole("link", { name: "Sign in" })
    await waitFor(() => expect(signIn).toHaveFocus())
    expect(signIn).toHaveAttribute("href", `/auth/login?returnTo=${encodeURIComponent(`${board}&date=2026-10-14`)}`)
    // Nothing of the booking was opened or sent.
    expect(screen.queryByRole("dialog", { name: "Book appointment" })).not.toBeInTheDocument()
    expect(writes(requests)).toHaveLength(0)
  })

  it("closes the prompt with Not now and gives focus back to Book appointment", async () => {
    mockBoardApi({ me: () => anonymous })
    renderBoard(board)

    const book = await bookButton()
    book.focus()
    fireEvent.click(book)
    const prompt = await screen.findByRole("dialog", { name: "Sign in to book" })

    fireEvent.click(within(prompt).getByRole("button", { name: "Not now" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sign in to book" })).not.toBeInTheDocument())
    await waitFor(() => expect(book).toHaveFocus())
  })

  it("asks to sign in from an empty day's Book appointment too", async () => {
    mockBoardApi({ me: () => anonymous, schedule: () => emptyTuesday })
    renderBoard(board)

    await screen.findByRole("heading", { name: "No appointments today" })
    const [, empty] = screen.getAllByRole("button", { name: "Book appointment" })
    fireEvent.click(empty)
    expect(await screen.findByRole("dialog", { name: "Sign in to book" })).toBeInTheDocument()
  })

  it("asks to sign in from the phone's floating Book action", async () => {
    phoneViewport()
    const { requests } = mockBoardApi({ me: () => anonymous })
    renderBoard(board)

    const fab = (await screen.findAllByRole("button", { name: "Book appointment" })).find((button) => button.dataset.slot === "book-fab")!
    fireEvent.click(fab)
    expect(await screen.findByRole("dialog", { name: "Sign in to book" })).toBeInTheDocument()
    expect(writes(requests)).toHaveLength(0)
  })
})

describe.each<[string, CurrentUserResponse, string]>([
  ["a Viewer", viewer, READ_ONLY_REASON],
  ["an account without a role", noRole, NO_ROLE_REASON],
])("booking as %s", (_, me, reason) => {
  it("shows Book appointment unavailable, with the reason on screen and read with it", async () => {
    const { requests } = mockBoardApi({ me: () => me })
    renderBoard(board)

    const book = await bookButton()
    expectUnavailableButFocusable(book)
    const note = document.getElementById(book.getAttribute("aria-describedby")!)
    expect(note).toHaveTextContent(reason)
    expect(note).toBeVisible()

    fireEvent.click(book)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(writes(requests)).toHaveLength(0)
  })

  it("shows the phone's floating Book action unavailable with the same reason", async () => {
    phoneViewport()
    mockBoardApi({ me: () => me })
    renderBoard(board)

    const fab = (await screen.findAllByRole("button", { name: "Book appointment" })).find((button) => button.dataset.slot === "book-fab")!
    expectUnavailableButFocusable(fab)
    expect(document.getElementById(fab.getAttribute("aria-describedby")!)).toHaveTextContent(reason)
  })
})

describe.each<[string, CurrentUserResponse]>([
  ["a Service advisor", serviceAdvisor],
  ["an Admin", admin],
])("booking as %s", (_, me) => {
  it("opens the booking dialog, with no reason shown", async () => {
    mockBoardApi({ me: () => me })
    renderBoard(board)

    const book = await bookButton()
    expectAvailable(book)
    expect(book).not.toHaveAttribute("aria-describedby")
    fireEvent.click(book)
    expect(await screen.findByRole("dialog", { name: "Book appointment" })).toBeInTheDocument()
    expect(screen.queryByText(READ_ONLY_REASON)).not.toBeInTheDocument()
  })
})

describe("the details sheet", () => {
  it("shows a visitor who is not signed in the board's masked card and a sign-in panel, without asking for the record", async () => {
    const { requests } = mockBoardApi({ me: () => anonymous })
    renderBoard(board)

    fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    const panel = within(sheet).getByRole("region", { name: "Sign in to see the whole booking" })
    expect(within(panel).getByText(/Contact details, the vehicle and cancelling need a workshop account\./)).toBeInTheDocument()
    expect(within(panel).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/auth/login?returnTo=${encodeURIComponent(board)}`)
    // No request the API would refuse, so no 401 and no error state; no cancellation form either.
    expect(requests.filter((request) => /\/api\/v1\/appointments\//.test(new URL(request.url).pathname))).toHaveLength(0)
    expect(within(sheet).queryByRole("alert")).not.toBeInTheDocument()
    expect(within(sheet).queryByRole("textbox", { name: "Reason" })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole("button", { name: "Cancel appointment" })).not.toBeInTheDocument()
  })

  it("shows a Viewer the whole record, and Cancel appointment unavailable with the reason", async () => {
    const { requests } = mockBoardApi({ me: () => viewer })
    renderBoard(board)

    fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    expect(await within(sheet).findByRole("link", { name: "sophie.turner@example.com" })).toBeInTheDocument()

    const cancel = within(sheet).getByRole("button", { name: "Cancel appointment" })
    expectUnavailableButFocusable(cancel)
    expect(document.getElementById(cancel.getAttribute("aria-describedby")!)).toHaveTextContent(READ_ONLY_REASON)
    expect(within(sheet).queryByRole("textbox", { name: "Reason" })).not.toBeInTheDocument()
    fireEvent.click(cancel)
    expect(writes(requests)).toHaveLength(0)
  })

  it("tells an account without a role why the details stay masked, without asking for them", async () => {
    const { requests } = mockBoardApi({ me: () => noRole })
    renderBoard(board)

    fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    expect(within(sheet).getByText(/Your account has no workshop role yet, so customer details stay masked\./)).toBeInTheDocument()
    expect(within(sheet).queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument()
    expect(requests.filter((request) => /\/api\/v1\/appointments\//.test(new URL(request.url).pathname))).toHaveLength(0)
  })

  it("lets a Service advisor cancel as before", async () => {
    mockBoardApi({ me: () => serviceAdvisor })
    renderBoard(board)

    fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    expect(within(sheet).getByRole("textbox", { name: "Reason" })).toBeInTheDocument()
    expectAvailable(within(sheet).getByRole("button", { name: "Cancel appointment" }))
  })
})

describe("a booking dialog open when the identity changes", () => {
  it("keeps what was typed, stops Suggest, the photos and Book, and says what to do once signed out", async () => {
    let me: CurrentUserResponse = serviceAdvisor
    const { requests } = mockBoardApi({ me: () => me, triageStatus: () => triageEnabled, serviceTypes: () => [interimServiceType] })
    renderBoard(board)

    fireEvent.click(await bookButton())
    const dialog = await screen.findByRole("dialog", { name: "Book appointment" })
    const description = await within(dialog).findByRole("textbox", { name: "Describe the issue" })
    fireEvent.change(description, { target: { value: "Brakes squeal" } })

    // Signed out in another tab: the board notices when its window regains focus.
    me = anonymous
    refocus()

    const signIn = await within(dialog).findByRole("link", { name: "Sign in" })
    expect(signIn).toHaveAttribute("href", `/auth/login?returnTo=${encodeURIComponent(board)}`)
    // An outline button, its border not overridden by the base's transparent one.
    expect(signIn).not.toHaveClass("border-transparent")
    const suggest = within(dialog).getByRole("button", { name: "Suggest a service" })
    expectUnavailableButFocusable(suggest)
    const reason = document.getElementById(suggest.getAttribute("aria-describedby")!)
    expect(reason).toHaveTextContent("You’re signed out, so this booking can’t be made. Sign in to book: what you entered here isn’t kept and will need entering again.")
    expect(within(dialog).getByLabelText("Photos or paperwork (optional)")).toBeDisabled()
    // What was typed is still there.
    expect(description).toHaveValue("Brakes squeal")

    fireEvent.click(suggest)
    expect(writes(requests)).toHaveLength(0)
  })

  it("keeps Book unavailable with the role's reason when the account loses its booking role", async () => {
    let me: CurrentUserResponse = serviceAdvisor
    const { requests } = mockBoardApi({ me: () => me, serviceTypes: () => [interimServiceType] })
    renderBoard(board)

    fireEvent.click(await bookButton())
    const dialog = await screen.findByRole("dialog", { name: "Book appointment" })
    fireEvent.click(await within(dialog).findByRole("combobox", { name: "Service" }))
    pointerClick(await screen.findByRole("option", { name: /^Interim Service/ }))
    const chip = await within(dialog).findByRole("radio", { name: "10:15, 4 bays and 3 technicians free" })
    fireEvent.click(chip)
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }))
    await within(dialog).findByRole("heading", { name: "Customer and vehicle" })

    me = viewer
    refocus()

    await waitFor(() => expectUnavailableButFocusable(within(dialog).getByRole("button", { name: "Book" })))
    const book = within(dialog).getByRole("button", { name: "Book" })
    expect(document.getElementById(book.getAttribute("aria-describedby")!)).toHaveTextContent(READ_ONLY_REASON)
    fireEvent.submit(book.closest("form")!)
    expect(writes(requests)).toHaveLength(0)
  })
})

describe("a /me that fails after it has answered", () => {
  it("withdraws booking and the whole record at once, clears what was read, and offers Try again", async () => {
    let failing = false
    const api = mockBoardApi({ me: () => (failing ? new Response("", { status: 502, statusText: "Bad Gateway" }) : admin) })
    const { queryClient } = renderBoard(board)
    fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    expect(await within(sheet).findByRole("link", { name: "sophie.turner@example.com" })).toBeInTheDocument()
    fireEvent.keyDown(sheet, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Interim Service" })).not.toBeInTheDocument())
    const recordReads = () => requestsTo(api.requests, `/appointments/${readingTuesday.bays[0].appointments[0].id}`).length
    const recordsBefore = recordReads()
    const schedulesBefore = requestsTo(api.requests, "/schedule").length

    // A gateway error when the window regains focus: who is signed in is no longer known.
    failing = true
    refocus()

    await waitFor(() => expect(requestsTo(api.requests, "/schedule").length).toBeGreaterThan(schedulesBefore))
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((query) => query.state.data))).not.toContain("sophie.turner@example.com")
    // Booking asks to sign in, and says the check failed, with Try again.
    fireEvent.click(await bookButton())
    const prompt = await screen.findByRole("dialog", { name: "Sign in to book" })
    expect(screen.queryByRole("dialog", { name: "Book appointment" })).not.toBeInTheDocument()
    expect(within(prompt).getByText("Couldn’t check who is signed in, so the app treats you as signed out.")).toBeInTheDocument()
    // The record is not read while nobody is known, even from a sheet opened again.
    fireEvent.click(within(prompt).getByRole("button", { name: "Not now" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sign in to book" })).not.toBeInTheDocument())
    fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
    const reopened = await screen.findByRole("dialog", { name: "Interim Service" })
    expect(within(reopened).getByRole("region", { name: "Sign in to see the whole booking" })).toBeInTheDocument()
    fireEvent.keyDown(reopened, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Interim Service" })).not.toBeInTheDocument())
    expect(recordReads()).toBe(recordsBefore)

    // Try again, and /me answers: booking opens again.
    failing = false
    fireEvent.click(await bookButton())
    const again = await screen.findByRole("dialog", { name: "Sign in to book" })
    fireEvent.click(within(again).getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(screen.queryByText("Couldn’t check who is signed in, so the app treats you as signed out.")).not.toBeInTheDocument())
    fireEvent.click(within(again).getByRole("button", { name: "Not now" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sign in to book" })).not.toBeInTheDocument())
    fireEvent.click(await bookButton())
    expect(await screen.findByRole("dialog", { name: "Book appointment" })).toBeInTheDocument()
  })
})
