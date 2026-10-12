import { screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { CurrentUserResponse } from "@/api/types.gen"
import { IDENTITY_CHECK_FAILED } from "@/components/auth/identity-check-failed"
import { READ_ONLY_REASON } from "@/lib/session"
import { mockBoardApi } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { admin, anonymous, viewer } from "@/test/identities"
import { pressBeforeTheChangeIsDrawn } from "@/test/identity-change"
import { renderBoard } from "@/test/render-board"

// The board's Book appointment decides when it is pressed, from the `/me` the cache holds at that moment (Task 28b review
// round 1, the same rule as the Overview's and the Calendar's): a press that lands after `/me` changed but before React
// has drawn the change opens nothing the new caller may not use.

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
