import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { CurrentUserResponse } from "@/api/types.gen"
import { IDENTITY_CHECK_FAILED } from "@/components/auth/identity-check-failed"
import { READ_ONLY_REASON } from "@/lib/session"
import { bookedFrom, mockBoardApi } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { admin, anonymous, viewer } from "@/test/identities"
import { pressBeforeTheChangeIsDrawn } from "@/test/identity-change"
import { pointerClick, renderBoard } from "@/test/render-board"
import { interimServiceType } from "@/test/schedules"

// Book appointment checks the cached `/me` when pressed so identity changes before re-render are respected.

beforeAll(async () => {
  await import("@/app/dispatch/page")
})

beforeEach(() => {
  // Tuesday 2026-10-13, 09:30 in Reading (BST). Only Date is faked; timers stay real for the UI.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => vi.useRealTimers())

type Caller = CurrentUserResponse | "unreadable"

const board = `/dispatch?dealership=${reading.id}`
const writes = (requests: readonly Request[]) => requests.filter((request) => request.method !== "GET")
const bookings = (requests: readonly Request[]) =>
  requests.filter((request) => request.method === "POST" && new URL(request.url).pathname.endsWith("/appointments"))

/** The board as an Admin sees it, Book appointment usable, with `/me` answering whatever `caller()` says from then on. */
async function boardAsAdmin() {
  const caller: { me: Caller } = { me: admin }
  const api = mockBoardApi({
    me: () => (caller.me === "unreadable" ? new Response("", { status: 502, statusText: "Bad Gateway" }) : caller.me),
  })
  const { queryClient } = renderBoard(board)
  const book = await screen.findByRole("button", { name: "Book appointment" })
  await waitFor(() => expect(book).not.toHaveAttribute("aria-disabled", "true"))
  return { api, queryClient, book, caller }
}

describe("the board's Book appointment, decided from the cached /me as it is pressed", () => {
  it("asks a caller who has just signed out to sign in, though the board still showed a caller who could book", async () => {
    const { api, queryClient, book, caller } = await boardAsAdmin()

    caller.me = anonymous
    expect(await pressBeforeTheChangeIsDrawn(queryClient, book)).toBe(true)

    expect(await screen.findByRole("dialog", { name: "Sign in to book" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Book appointment" })).not.toBeInTheDocument()
    expect(writes(api.requests)).toHaveLength(0)
  })

  it("opens nothing for a caller who has just become a Viewer, and the board then names the reason", async () => {
    const { api, queryClient, book, caller } = await boardAsAdmin()

    caller.me = viewer
    expect(await pressBeforeTheChangeIsDrawn(queryClient, book)).toBe(true)

    expect(await screen.findByText(READ_ONLY_REASON)).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(writes(api.requests)).toHaveLength(0)
  })

  it("asks to sign in, saying the check failed, when /me has just failed to be read again", async () => {
    const { api, queryClient, book, caller } = await boardAsAdmin()

    caller.me = "unreadable"
    expect(await pressBeforeTheChangeIsDrawn(queryClient, book)).toBe(true)

    const prompt = await screen.findByRole("dialog", { name: "Sign in to book" })
    expect(within(prompt).getByText(IDENTITY_CHECK_FAILED)).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Book appointment" })).not.toBeInTheDocument()
    expect(writes(api.requests)).toHaveLength(0)
  })
})

// A press opens the dialog exactly when a booking entered in it can be sent: both are decided from the writer the cache
// names (`cachedWriteAccess` from `cachedWriter`), so a press that lands before the board has drawn a new account that may
// book opens a dialog drawn for that account, and its Book is sent once.
describe("the board's Book appointment, pressed for an account that may book that the board has not drawn yet", () => {
  it.each<[string, CurrentUserResponse, CurrentUserResponse]>([
    ["a visitor who has just signed in as an Admin", anonymous, admin],
    ["another account that may book, after an Admin", admin, { ...admin, email: "another.admin@keyloop.test", displayName: "Another Admin" }],
  ])("for %s, opens the dialog drawn for them, and their booking is sent once", async (_, first, next) => {
    const caller: { me: CurrentUserResponse } = { me: first }
    const api = mockBoardApi({
      me: () => caller.me,
      serviceTypes: () => [interimServiceType],
      book: (_, body) => bookedFrom(body),
    })
    const { queryClient } = renderBoard(board)
    const book = await screen.findByRole("button", { name: "Book appointment" })
    await waitFor(() => expect(book).not.toHaveAttribute("aria-disabled", "true"))

    caller.me = next
    expect(await pressBeforeTheChangeIsDrawn(queryClient, book)).toBe(true)

    const dialog = await screen.findByRole("dialog", { name: "Book appointment" })
    expect(within(dialog).queryByText(/The session changed/)).not.toBeInTheDocument()
    fireEvent.click(await within(dialog).findByRole("combobox", { name: "Service" }))
    pointerClick(await screen.findByRole("option", { name: /^Interim Service/ }))
    fireEvent.click(await within(dialog).findByRole("radio", { name: "10:15, 4 bays and 3 technicians free" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }))
    await within(dialog).findByRole("heading", { name: "Customer and vehicle" })
    for (const [label, value] of Object.entries({ Name: "Pressed Customer", Email: "pressed@example.invalid", Phone: "+44 7700 900888" })) {
      fireEvent.change(within(dialog).getByRole("textbox", { name: label }), { target: { value } })
    }
    for (const [label, value] of Object.entries({ VIN: "WVWZZZ1KZAW654322", Registration: "PR22 ESS", Make: "Volkswagen", Model: "Golf" })) {
      fireEvent.change(within(dialog).getByRole("textbox", { name: label }), { target: { value } })
    }
    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))

    expect(await screen.findByText("Booked")).toBeInTheDocument()
    expect(bookings(api.requests)).toHaveLength(1)
  })
})
