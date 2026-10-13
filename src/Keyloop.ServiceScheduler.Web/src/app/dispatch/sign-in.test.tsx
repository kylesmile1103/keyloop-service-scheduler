import { focusManager } from "@tanstack/react-query"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { CurrentUserResponse, WorkshopScheduleResponse } from "@/api/types.gen"
import { NO_ROLE_REASON, READ_ONLY_REASON } from "@/lib/session"
import { mockBoardApi, requestsTo } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { findInspector, queryInspector, startCancelling } from "@/test/details"
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

describe("a booking's details (docked beside the board at 1440 px)", () => {
  it("shows a visitor who is not signed in the board's masked card and a sign-in panel, without asking for the record", async () => {
    const { requests } = mockBoardApi({ me: () => anonymous })
    renderBoard(board)

    fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
    const sheet = await findInspector()
    const panel = within(sheet).getByRole("region", { name: "Sign in to see the whole booking" })
    expect(within(panel).getByText(/Contact details, the vehicle and cancelling need a workshop account\./)).toBeInTheDocument()
    expect(within(panel).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/auth/login?returnTo=${encodeURIComponent(board)}`)
    // No request the API would refuse, so no 401 and no error state; no cancellation form either.
    expect(requests.filter((request) => /\/api\/v1\/appointments\//.test(new URL(request.url).pathname))).toHaveLength(0)
    expect(within(sheet).queryByRole("alert")).not.toBeInTheDocument()
    expect(within(sheet).queryByRole("textbox", { name: "Reason" })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole("button", { name: "Cancel booking…" })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole("button", { name: "Cancel appointment" })).not.toBeInTheDocument()
  })

  it("shows a Viewer the whole record, and Cancel booking unavailable with the reason", async () => {
    const { requests } = mockBoardApi({ me: () => viewer })
    renderBoard(board)

    fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
    const sheet = await findInspector()
    expect(await within(sheet).findByRole("link", { name: "sophie.turner@example.com" })).toBeInTheDocument()

    const cancel = within(sheet).getByRole("button", { name: "Cancel booking…" })
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
    const sheet = await findInspector()
    expect(within(sheet).getByText(/Your account has no workshop role yet, so customer details stay masked\./)).toBeInTheDocument()
    expect(within(sheet).queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument()
    expect(requests.filter((request) => /\/api\/v1\/appointments\//.test(new URL(request.url).pathname))).toHaveLength(0)
  })

  it("lets a Service advisor cancel as before", async () => {
    mockBoardApi({ me: () => serviceAdvisor })
    renderBoard(board)

    fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
    const sheet = await findInspector()
    expect(startCancelling(sheet)).toBeInTheDocument()
    expectAvailable(within(sheet).getByRole("button", { name: "Cancel appointment" }))
  })
})

/** What step 2 holds, every value personal. */
const draft = {
  Name: "Draft Private Customer",
  Email: "draft.private@example.invalid",
  Phone: "+44 7700 900777",
  VIN: "WVWZZZ1KZAW654321",
  Registration: "DR22 AFT",
  Make: "Volkswagen",
  Model: "Golf",
}
const description = "Private description of the brakes"

/** Every value the dialog's fields hold, and its text. */
function dialogContents(dialog: HTMLElement): string {
  const values = Array.from(dialog.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")).map((field) => field.value)
  return `${dialog.textContent ?? ""} ${values.join(" ")}`
}

/**
 * A booking entered by hand: a description and a photo, Interim Service at 10:15, then (unless it stays on step 1, where the
 * photo's preview shows) the customer and the vehicle.
 */
async function enterDraft(dialog: HTMLElement, step: 1 | 2 = 2) {
  fireEvent.change(await within(dialog).findByRole("textbox", { name: "Describe the issue" }), { target: { value: description } })
  const photo = new File([new Uint8Array([137, 80, 78, 71])], "private-vehicle-photo.png", { type: "image/png" })
  fireEvent.change(within(dialog).getByLabelText("Photos or paperwork (optional)"), { target: { files: [photo] } })
  expect(within(dialog).getByAltText("Selected photo: private-vehicle-photo.png")).toBeInTheDocument()
  if (step === 1) return
  fireEvent.click(await within(dialog).findByRole("combobox", { name: "Service" }))
  pointerClick(await screen.findByRole("option", { name: /^Interim Service/ }))
  fireEvent.click(await within(dialog).findByRole("radio", { name: "10:15, 4 bays and 3 technicians free" }))
  fireEvent.click(within(dialog).getByRole("button", { name: "Next" }))
  await within(dialog).findByRole("heading", { name: "Customer and vehicle" })
  for (const [label, value] of Object.entries(draft)) {
    fireEvent.change(within(dialog).getByRole("textbox", { name: label }), { target: { value } })
  }
}

function expectDraftGone(dialog: HTMLElement) {
  const contents = dialogContents(dialog)
  for (const value of [...Object.values(draft), description, "private-vehicle-photo.png"]) {
    expect(contents, `${value} still in the dialog`).not.toContain(value)
  }
  expect(within(dialog).queryByAltText("Selected photo: private-vehicle-photo.png")).not.toBeInTheDocument()
}

describe("a booking dialog open when the identity changes", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test-photo") })
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() })
  })

  async function openWithDraft(
    next: () => CurrentUserResponse | Response,
    options: Parameters<typeof mockBoardApi>[0] = {},
    step: 1 | 2 = 2
  ) {
    let changed = false
    const api = mockBoardApi({
      me: () => (changed ? next() : admin),
      triageStatus: () => triageEnabled,
      serviceTypes: () => [interimServiceType],
      ...options,
    })
    renderBoard(board)
    fireEvent.click(await bookButton())
    const dialog = await screen.findByRole("dialog", { name: "Book appointment" })
    await enterDraft(dialog, step)
    return {
      api,
      dialog,
      change() {
        changed = true
        refocus()
      },
    }
  }

  it("discards the draft and its photo once signed out, says why, and offers Sign in", async () => {
    const { api, dialog, change } = await openWithDraft(() => anonymous)
    within(dialog).getByRole("textbox", { name: "Email" }).focus()

    change()

    const notice = await within(dialog).findByText(/^The session changed: you’re signed out\./)
    // The focused field went with the draft: focus is on the notice that says why, still in the dialog.
    await waitFor(() => expect(notice.closest("[tabindex]")).toHaveFocus())
    expect(notice).toHaveTextContent(
      "The session changed: you’re signed out. The booking you were entering was discarded, with its customer, vehicle, description and photos. Sign in to book."
    )
    expectDraftGone(dialog)
    const signIn = within(dialog).getByRole("link", { name: "Sign in" })
    expect(signIn).toHaveAttribute("href", `/auth/login?returnTo=${encodeURIComponent(board)}`)
    expect(signIn).not.toHaveClass("border-transparent")
    // Back at the start, with Suggest a service and the photos unavailable, named by the notice.
    const suggest = within(dialog).getByRole("button", { name: "Suggest a service" })
    expectUnavailableButFocusable(suggest)
    expect(document.getElementById(suggest.getAttribute("aria-describedby")!)).toBe(notice.closest("[id]"))
    expect(within(dialog).getByLabelText("Photos or paperwork (optional)")).toBeDisabled()
    fireEvent.click(suggest)
    expect(writes(api.requests)).toHaveLength(0)
  })

  it("discards the description and the photo on step 1 too, revoking the preview's address", async () => {
    const { dialog, change } = await openWithDraft(() => anonymous, {}, 1)
    vi.mocked(URL.revokeObjectURL).mockClear()

    change()

    await within(dialog).findByText(/^The session changed: you’re signed out\./)
    expectDraftGone(dialog)
    expect(within(dialog).getByRole("textbox", { name: "Describe the issue" })).toHaveValue("")
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-photo")
  })

  it("discards it when the account loses its booking role, with the role's reason on Book's place", async () => {
    const { api, dialog, change } = await openWithDraft(() => ({ ...admin, roles: ["Viewer"] }))

    change()

    const notice = await within(dialog).findByText(/^The session changed: this account can’t book any more\./)
    expect(notice).toHaveTextContent("The booking you were entering was discarded, with its customer, vehicle, description and photos.")
    expectDraftGone(dialog)
    const suggest = within(dialog).getByRole("button", { name: "Suggest a service" })
    expectUnavailableButFocusable(suggest)
    expect(document.getElementById(suggest.getAttribute("aria-describedby")!)).toHaveTextContent("this account can’t book any more")
    expect(writes(api.requests)).toHaveLength(0)
  })

  it("discards it when another account signs in, even one that may book", async () => {
    const { dialog, change } = await openWithDraft(() => serviceAdvisor)

    change()

    const notice = await within(dialog).findByText(/^The session changed: another account is signed in\./)
    expect(notice).toHaveTextContent("Enter it again to book it.")
    expectDraftGone(dialog)
    expectAvailable(within(dialog).getByRole("button", { name: "Suggest a service" }))
  })

  it("discards it when who is signed in cannot be checked, with Try again", async () => {
    const { dialog, change } = await openWithDraft(() => new Response("", { status: 502, statusText: "Bad Gateway" }))

    change()

    expect(await within(dialog).findByText(/^The session changed: who is signed in couldn’t be checked\./)).toBeInTheDocument()
    expectDraftGone(dialog)
    expect(within(dialog).getByRole("button", { name: "Try again" })).toBeInTheDocument()
  })

  it("says a booking may have been made when Book had been pressed", async () => {
    const { dialog, change } = await openWithDraft(() => anonymous, { book: () => new Promise(() => {}) })
    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))
    await within(dialog).findByRole("button", { name: "Booking…" })

    change()

    const notice = await within(dialog).findByText(/^The session changed: you’re signed out\./)
    expect(notice).toHaveTextContent("Book had been pressed, so it may have been booked: check the board before entering it again.")
    expectDraftGone(dialog)
  })

  it("says a booking had been made when the phone's success state was showing", async () => {
    phoneViewport()
    let changed = false
    mockBoardApi({ me: () => (changed ? anonymous : admin), triageStatus: () => triageEnabled, serviceTypes: () => [interimServiceType] })
    renderBoard(board)
    const fab = (await screen.findAllByRole("button", { name: "Book appointment" })).find((button) => button.dataset.slot === "book-fab")!
    fireEvent.click(fab)
    const sheet = await screen.findByRole("dialog", { name: "Book appointment" })
    await enterDraft(sheet)
    fireEvent.click(within(sheet).getByRole("button", { name: "Book" }))
    expect(await within(sheet).findByRole("heading", { name: "Booked" })).toBeInTheDocument()

    changed = true
    refocus()

    const notice = await within(sheet).findByText(/^The session changed: you’re signed out\./)
    expect(notice).toHaveTextContent("This dialog was cleared. The booking had been made: it is on the board. Sign in to book.")
    expect(within(sheet).queryByRole("heading", { name: "Booked" })).not.toBeInTheDocument()
    expectDraftGone(sheet)
  })

  it("keeps the draft between two roles that may book, for the same email", async () => {
    const { dialog, change } = await openWithDraft(() => ({ ...admin, roles: ["ServiceAdvisor"] }))

    change()

    await waitFor(() => expect(screen.getByRole("dialog", { name: "Book appointment" })).toBeInTheDocument())
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(within(dialog).getByRole("textbox", { name: "Email" })).toHaveValue(draft.Email)
    expect(within(dialog).queryByText(/The session changed/)).not.toBeInTheDocument()
    expectAvailable(within(dialog).getByRole("button", { name: "Book" }))
  })
})

describe("a /me that fails after it has answered", () => {
  it("withdraws booking and the whole record at once, clears what was read, and offers Try again", async () => {
    let failing = false
    const api = mockBoardApi({ me: () => (failing ? new Response("", { status: 502, statusText: "Bad Gateway" }) : admin) })
    const { queryClient } = renderBoard(board)
    fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
    const sheet = await findInspector()
    expect(await within(sheet).findByRole("link", { name: "sophie.turner@example.com" })).toBeInTheDocument()
    fireEvent.keyDown(sheet, { key: "Escape" })
    await waitFor(() => expect(queryInspector()).not.toBeInTheDocument())
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
    // The record is not read while nobody is known, even from details opened again.
    fireEvent.click(within(prompt).getByRole("button", { name: "Not now" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sign in to book" })).not.toBeInTheDocument())
    fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
    const reopened = await findInspector()
    expect(within(reopened).getByRole("region", { name: "Sign in to see the whole booking" })).toBeInTheDocument()
    fireEvent.keyDown(reopened, { key: "Escape" })
    await waitFor(() => expect(queryInspector()).not.toBeInTheDocument())
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
