import { focusManager } from "@tanstack/react-query"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest"

import type { CurrentUserResponse } from "@/api/types.gen"
import { browserNavigation } from "@/lib/session-renewal"
import { mockBoardApi, requestsTo } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { startCancelling } from "@/test/details"
import { admin, anonymous, expiringAt, serviceAdvisor } from "@/test/identities"
import { problemResponse } from "@/test/mock-api"
import { pointerClick, renderBoard, viewportOf } from "@/test/render-board"

beforeAll(async () => {
  await import("@/app/dispatch/page")
})

const board = `/dispatch?dealership=${reading.id}`
const here = `${board}#timeline`
const renewal = `/auth/login?returnTo=${encodeURIComponent(here)}`
const SHEET_WIDTH = 1024
const interimLabel = "Interim Service, Bay 1 - Standard, 08:00 to 09:00, Amelia Clarke, Confirmed"
const END = "2026-10-13T09:30:00Z"

let navigate: MockInstance<(href: string) => void>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
  window.history.replaceState(null, "", here)
  navigate = vi.spyOn(browserNavigation, "assign").mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  focusManager.setFocused(undefined)
  window.history.replaceState(null, "", "/")
})

const until = (iso: string) => act(() => vi.advanceTimersByTimeAsync(Date.parse(iso) - Date.now()))
const meReads = (requests: readonly Request[]) => requestsTo(requests, "/api/v1/me").length
const banner = () => screen.queryAllByRole("status").find((element) => element.textContent?.startsWith("Your sign-in"))
const findBanner = (title: string) =>
  waitFor(() => {
    const found = banner()
    expect(found).toHaveTextContent(title)
    return found!
  })

function refocus() {
  act(() => {
    focusManager.setFocused(false)
    focusManager.setFocused(true)
  })
}

async function typeCancellationReason() {
  fireEvent.click(await screen.findByRole("button", { name: interimLabel }))
  const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
  const reason = startCancelling(sheet)
  fireEvent.change(reason, { target: { value: "Customer rang to rearrange" } })
  act(() => reason.focus())
  return { sheet, reason }
}

describe("session renewal", () => {
  it("renews two minutes before the sign-in ends, reading /me first, coming back to this page with its search and hash", async () => {
    const api = mockBoardApi({ me: () => expiringAt(serviceAdvisor, END) })
    renderBoard(board)
    await screen.findByRole("button", { name: interimLabel })
    const before = meReads(api.requests)

    await until("2026-10-13T09:27:59Z")
    expect(navigate).not.toHaveBeenCalled()
    expect(meReads(api.requests)).toBe(before)

    await until("2026-10-13T09:28:00Z")
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
    expect(navigate).toHaveBeenCalledWith(renewal)
    // /me was read again first: another tab may already have renewed the cookie they share.
    expect(meReads(api.requests)).toBe(before + 1)
    expect(banner()).toBeUndefined()
  })

  it("leaves the page alone when /me, read again at renewal time, shows another tab has renewed, and renews the new sign-in later", async () => {
    let me = expiringAt(serviceAdvisor, END)
    const api = mockBoardApi({ me: () => me })
    renderBoard(board)
    await screen.findByRole("button", { name: interimLabel })
    const before = meReads(api.requests)

    me = expiringAt(serviceAdvisor, "2026-10-13T10:28:00Z")
    await until("2026-10-13T09:28:00Z")
    await waitFor(() => expect(meReads(api.requests)).toBe(before + 1))
    await until("2026-10-13T09:29:00Z")
    expect(navigate).not.toHaveBeenCalled()
    expect(banner()).toBeUndefined()

    await until("2026-10-13T10:26:00Z")
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(renewal))
  })

  it("with work open, says when the sign-in ends and offers Stay signed in, without taking focus or renewing on its own", async () => {
    mockBoardApi({ me: () => expiringAt(serviceAdvisor, END) })
    viewportOf(SHEET_WIDTH)
    renderBoard(board)
    const { sheet, reason } = await typeCancellationReason()

    await until("2026-10-13T09:28:00Z")
    // Readable while the sheet is open (Base UI leaves aria-live regions out of what a modal hides).
    const shown = await findBanner("Your sign-in ends at 09:30.")
    expect(shown).toHaveTextContent("Your sign-in ends at 09:30. Save or finish what you are doing, then stay signed in.")
    expect(navigate).not.toHaveBeenCalled()
    expect(reason).toHaveFocus()
    expect(reason).toHaveValue("Customer rang to rearrange")
    // The sheet covers the page's banner, so it says the same inside, without an action that would lose the reason.
    expect(within(sheet).getByText(/Save or finish this, then choose Stay signed in on the page\./)).toHaveTextContent(
      "Your sign-in ends at 09:30. Save or finish this, then choose Stay signed in on the page."
    )
    expect(within(sheet).queryByRole("button", { name: "Stay signed in" })).not.toBeInTheDocument()

    // The work is put away; the tab regains focus. The person was offered the choice, so it is still theirs.
    fireEvent.keyDown(sheet, { key: "Escape" })
    await waitFor(() => expect(sheet).not.toBeInTheDocument())
    act(() => void window.dispatchEvent(new Event("focus")))
    await until("2026-10-13T09:28:30Z")
    expect(navigate).not.toHaveBeenCalled()

    fireEvent.click(within(shown).getByRole("button", { name: "Stay signed in" }))
    expect(navigate).toHaveBeenCalledExactlyOnceWith(renewal)
  })

  it("hides on Not now, then says the sign-in ended when it does, with Sign in again, and reads /me again once the API agrees", async () => {
    const api = mockBoardApi({ me: () => expiringAt(serviceAdvisor, END) })
    viewportOf(SHEET_WIDTH)
    renderBoard(board)
    await typeCancellationReason()
    await until("2026-10-13T09:28:00Z")
    fireEvent.click(within(await findBanner("Your sign-in ends at 09:30.")).getByRole("button", { name: "Not now" }))
    await waitFor(() => expect(banner()).toBeUndefined())

    await until(END)
    const ended = await findBanner("Your sign-in ended.")
    expect(screen.queryByText(/choose Stay signed in on the page/)).not.toBeInTheDocument()
    expect(ended).toHaveTextContent("Your sign-in ended. Sign in again to carry on where you left off.")
    const reads = meReads(api.requests)
    // The API accepts the token for its clock skew; then /me is read again, so every view agrees.
    await until("2026-10-13T09:31:00Z")
    await waitFor(() => expect(meReads(api.requests)).toBe(reads + 1))
    expect(navigate).not.toHaveBeenCalled()

    fireEvent.click(within(ended).getByRole("button", { name: "Sign in again" }))
    expect(navigate).toHaveBeenCalledExactlyOnceWith(renewal)
  })

  it("says the sign-in ended when /me turns anonymous for a tab that was signed in", async () => {
    let me: CurrentUserResponse = expiringAt(serviceAdvisor, "2026-10-13T17:30:00Z")
    mockBoardApi({ me: () => me })
    renderBoard(board)
    await screen.findByRole("button", { name: interimLabel })
    expect(banner()).toBeUndefined()

    me = anonymous
    refocus()
    expect(await findBanner("Your sign-in ended.")).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  it("says the sign-in ended as soon as a write is refused with 401, beside the session dialog", async () => {
    let me: () => CurrentUserResponse | Promise<CurrentUserResponse> = () => expiringAt(serviceAdvisor, "2026-10-13T17:30:00Z")
    mockBoardApi({
      me: () => me(),
      cancel: () => {
        // The re-read of /me SessionWatch asks for has not answered yet: the refusal alone says the sign-in ended.
        me = () => new Promise<CurrentUserResponse>(() => {})
        return problemResponse(401, {
          type: "https://api.keyloop.example/problems/unauthenticated",
          title: "Authentication required",
          status: 401,
          loginUrl: "/auth/login?returnTo=%2F",
        })
      },
    })
    viewportOf(SHEET_WIDTH)
    renderBoard(board)
    const { sheet } = await typeCancellationReason()
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel appointment" }))

    expect(await screen.findByRole("dialog", { name: "Your session has ended" })).toBeInTheDocument()
    expect(await findBanner("Your sign-in ended.")).toBeInTheDocument()
  })

  it.each<[string, CurrentUserResponse]>([
    ["the API's answer", expiringAt(serviceAdvisor, "2026-10-13T09:29:30Z")],
    ["an anonymous answer", anonymous],
  ])("never renews on its own again when a renewal comes back still ending within two minutes (%s)", async (_, answer) => {
    let me: CurrentUserResponse = expiringAt(serviceAdvisor, END)
    mockBoardApi({ me: () => me })
    renderBoard(board)
    await screen.findByRole("button", { name: interimLabel })
    await until("2026-10-13T09:28:00Z")
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))

    // The renewal's navigation comes back to a fresh page, which /me answers as still ending soon, or signed out.
    cleanup()
    me = answer
    renderBoard(board)
    if (answer.authenticated) {
      const shown = await findBanner("Your sign-in ends at 09:29.")
      expect(within(shown).getByRole("button", { name: "Stay signed in" })).toBeInTheDocument()
    } else {
      expect(await findBanner("Your sign-in ended.")).toBeInTheDocument()
    }
    await until("2026-10-13T09:29:20Z")
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it.each<[string, CurrentUserResponse]>([
    ["the Development identity, which has no expiry", admin],
    ["a visitor who never signed in", anonymous],
  ])("schedules nothing and shows nothing for %s", async (_, me) => {
    const api = mockBoardApi({ me: () => me })
    renderBoard(board)
    await screen.findByRole("button", { name: /^Interim Service, Bay 1 - Standard, 08:00 to 09:00/ })
    const before = meReads(api.requests)

    await until("2026-10-13T11:30:00Z")
    expect(navigate).not.toHaveBeenCalled()
    expect(banner()).toBeUndefined()
    expect(meReads(api.requests)).toBe(before)
  })

  it("looks again when the tab becomes visible, since timers sleep in a background tab or on a sleeping device", async () => {
    mockBoardApi({ me: () => expiringAt(serviceAdvisor, END) })
    renderBoard(board)
    await screen.findByRole("button", { name: interimLabel })

    // The device slept through the renewal time: the clock moved on, the timer did not run.
    vi.setSystemTime(new Date("2026-10-13T09:29:00Z"))
    expect(navigate).not.toHaveBeenCalled()
    act(() => void document.dispatchEvent(new Event("visibilitychange")))
    await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith(renewal))
  })

  it("says the sign-in ended when the tab becomes visible after it has", async () => {
    mockBoardApi({ me: () => expiringAt(serviceAdvisor, END) })
    renderBoard(board)
    await screen.findByRole("button", { name: interimLabel })

    vi.setSystemTime(new Date("2026-10-13T09:45:00Z"))
    act(() => void document.dispatchEvent(new Event("visibilitychange")))
    expect(await findBanner("Your sign-in ended.")).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  describe("a booking being entered", () => {
    async function openBooking() {
      fireEvent.click(await screen.findByRole("button", { name: "Book appointment" }))
      return screen.findByRole("dialog", { name: "Book appointment" })
    }

    it("holds the renewal once something is entered", async () => {
      mockBoardApi({ me: () => expiringAt(serviceAdvisor, END) })
      renderBoard(board)
      const scope = await openBooking()
      fireEvent.click(within(scope).getByRole("combobox", { name: "Service" }))
      pointerClick(await screen.findByRole("option", { name: /^Interim Service/ }))
      await waitFor(() => expect(within(scope).getByRole("combobox", { name: "Service" })).toHaveTextContent("Interim Service"))

      await until("2026-10-13T09:28:00Z")
      expect(await findBanner("Your sign-in ends at 09:30.")).toBeInTheDocument()
      expect(within(scope).getByText(/Save or finish this, then choose Stay signed in on the page\./)).toBeInTheDocument()
      expect(navigate).not.toHaveBeenCalled()
      expect(scope).toBeInTheDocument()
    })

    it("does not hold it while nothing is entered", async () => {
      mockBoardApi({ me: () => expiringAt(serviceAdvisor, END) })
      renderBoard(board)
      await openBooking()

      await until("2026-10-13T09:28:00Z")
      await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith(renewal))
    })
  })
})
