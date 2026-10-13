import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { AppointmentResponse, CurrentUserResponse } from "@/api/types.gen"
import { mockBoardApi, requestsTo } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { findInspector, queryInspector, startCancelling } from "@/test/details"
import { admin, anonymous, viewer } from "@/test/identities"
import { deferred, maskedSchedule, refocus } from "@/test/identity-change"
import { matchesWidth } from "@/test/media-query"
import { renderBoard, viewportOf } from "@/test/render-board"
import { appointments, interimDetails, readingTuesday, without } from "@/test/schedules"

// The docked inspector (Task 34, UI_DESIGN 11.14): from 1280 px a booking's details sit beside the board, which stays usable;
// narrower boards keep the sheet. Cancelling goes through a short confirm.

beforeAll(async () => {
  await import("@/app/dispatch/page")
})

beforeEach(() => {
  // Tuesday 2026-10-13, 09:30 in Reading (BST). Only Date is faked; timers stay real for the UI.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

const board = `/dispatch?dealership=${reading.id}`
const interimLabel = "Interim Service, Bay 1 - Standard, 08:00 to 09:00, Amelia Clarke, Confirmed"
const brakesLabel = "Brake Pads & Discs, Bay 1 - Standard, 10:30 to 12:00, Chloe Nguyen, Confirmed"
const block = (name: string | RegExp) => screen.findByRole("button", { name })
const cancels = (requests: readonly Request[]) => requestsTo(requests, "/cancel")

describe("a booking's details at 1280 px and wider", () => {
  beforeEach(() => viewportOf(1280))

  it("dock beside the board as a complementary landmark, with no dialog and no scrim", async () => {
    mockBoardApi()
    renderBoard(board)

    fireEvent.click(await block(interimLabel))

    const inspector = await findInspector()
    expect(inspector.tagName).toBe("ASIDE")
    // Sticky, and sized to the window below its top (the measured offset and cap; jsdom has no layout, so the browser
    // check and the E2E journey measure where it ends): header, scrolling cards, then the pinned action row.
    expect(inspector).toHaveClass("sticky", "top-4", "flex-col")
    expect(inspector.style.getPropertyValue("--inspector-offset")).toMatch(/^\d+px$/)
    expect(inspector.style.getPropertyValue("--inspector-cap")).toMatch(/^\d+px$/)
    expect([...inspector.children].map((part) => part.getAttribute("data-slot"))).toEqual(["details-header", "details-body", "details-actions"])
    // The board keeps its own height: no row is added under its last lane.
    const timeline = screen.getByRole("region", { name: "Timeline by bay" }).firstElementChild as HTMLElement
    expect(timeline.style.gridTemplateRows).toBe(`2.5rem repeat(${readingTuesday.bays.length}, auto)`)
    expect(within(inspector).getByRole("heading", { level: 2, name: "Interim Service" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    // The board is not hidden from assistive technology: its blocks are found without `hidden: true`.
    const interim = screen.getByRole("button", { name: interimLabel })
    expect(interim).toHaveAttribute("aria-current", "true")
    expect(interim).toHaveAttribute("data-selected")
    expect(interim).not.toHaveAttribute("aria-haspopup")
    // Sectioned cards, the record once it is read, and the reference as a quiet footer line.
    for (const card of ["Job", "Customer", "Vehicle"]) {
      expect(within(inspector).getByRole("heading", { level: 3, name: card })).toBeInTheDocument()
    }
    expect(await within(inspector).findByRole("link", { name: "sophie.turner@example.com" })).toBeInTheDocument()
    expect(within(inspector).getByRole("heading", { level: 3, name: "Notes" })).toBeInTheDocument()
    expect(within(inspector).getByRole("button", { name: "Copy email" })).toBeInTheDocument()
    expect(within(inspector).getByRole("button", { name: "Copy phone number" })).toBeInTheDocument()
    expect(within(inspector).getByRole("button", { name: "Copy VIN" })).toBeInTheDocument()
    expect(within(inspector).getByRole("button", { name: "Copy appointment reference" })).toBeInTheDocument()
    expect(within(inspector).getByText("Customer waiting in the lounge.")).toBeInTheDocument()
    // No form until it is asked for.
    expect(within(inspector).queryByRole("textbox", { name: "Reason" })).not.toBeInTheDocument()
    expect(within(inspector).getByRole("button", { name: "Cancel booking…" })).toBeInTheDocument()
  })

  it("move focus to the service's heading, and keep the board usable: another booking swaps the details in place", async () => {
    mockBoardApi()
    renderBoard(board)
    fireEvent.click(await block(interimLabel))
    const inspector = await findInspector()
    await waitFor(() => expect(within(inspector).getByRole("heading", { name: "Interim Service" })).toHaveFocus())

    const brakes = screen.getByRole("button", { name: brakesLabel })
    brakes.focus()
    fireEvent.click(brakes)

    // The same landmark, now showing the other booking, which is the marked one.
    await waitFor(() => expect(within(inspector).getByRole("heading", { level: 2, name: "Brake Pads & Discs" })).toHaveFocus())
    expect(findAllInspectors()).toEqual([inspector])
    expect(screen.getByRole("button", { name: brakesLabel })).toHaveAttribute("aria-current", "true")
    expect(screen.getByRole("button", { name: interimLabel })).not.toHaveAttribute("aria-current")
    expect(await within(inspector).findByRole("link", { name: "customer@example.com" })).toBeInTheDocument()
    expect(within(inspector).getByText("Emily Clarkson")).toBeInTheDocument()
    expect(within(inspector).queryByText("sophie.turner@example.com")).not.toBeInTheDocument()

    // Escape closes them, and focus goes back to the block that opened them last.
    fireEvent.keyDown(document.activeElement!, { key: "Escape" })
    await waitFor(() => expect(queryInspector()).not.toBeInTheDocument())
    expect(screen.getByRole("button", { name: brakesLabel })).toHaveFocus()
    expect(screen.getByRole("button", { name: brakesLabel })).not.toHaveAttribute("aria-current")
  })

  it("close with the close button, giving focus back to the block", async () => {
    mockBoardApi()
    renderBoard(board)
    fireEvent.click(await block(interimLabel))
    const inspector = await findInspector()
    const close = within(inspector).getByRole("button", { name: "Close" })

    close.focus()
    fireEvent.click(close)

    await waitFor(() => expect(queryInspector()).not.toBeInTheDocument())
    expect(screen.getByRole("button", { name: interimLabel })).toHaveFocus()
  })

  it("stay open while the lane view changes, marking the booking in the technicians' lanes too", async () => {
    mockBoardApi()
    renderBoard(board)
    fireEvent.click(await block(interimLabel))
    const inspector = await findInspector()

    fireEvent.click(screen.getByRole("tab", { name: "Technicians" }))

    const amelia = await screen.findByRole("group", { name: /^Amelia Clarke/ })
    expect(within(amelia).getByRole("button", { name: /^Interim Service/ })).toHaveAttribute("aria-current", "true")
    expect(inspector).toBeInTheDocument()
  })

  it("show a visitor the board's masked snapshot and the sign-in panel, with no record read and no actions", async () => {
    const { requests } = mockBoardApi({ me: () => anonymous, schedule: () => maskedSchedule(readingTuesday) })
    renderBoard(board)

    fireEvent.click(await block(/^Interim Service, Bay 1 - Standard, 08:00 to 09:00/))
    const inspector = await findInspector()

    expect(within(inspector).getByText("ST")).toBeInTheDocument()
    expect(within(inspector).getByText("***********123460")).toBeInTheDocument()
    expect(within(inspector).getByText("*******")).toBeInTheDocument()
    expect(within(inspector).queryByText("Email")).not.toBeInTheDocument()
    expect(within(inspector).queryByText("Phone")).not.toBeInTheDocument()
    // Nothing to copy that the caller may not read.
    expect(within(inspector).queryByRole("button", { name: "Copy VIN" })).not.toBeInTheDocument()
    expect(within(inspector).getByRole("region", { name: "Sign in to see the whole booking" })).toBeInTheDocument()
    expect(within(inspector).queryByRole("button", { name: "Cancel booking…" })).not.toBeInTheDocument()
    expect(requestsTo(requests, `/appointments/${appointments.interim.id}`)).toHaveLength(0)
  })

  it("close in the same render as a change of who is signed in, focus going back to the block", async () => {
    let me: CurrentUserResponse = admin
    mockBoardApi({ me: () => me, schedule: () => (me === anonymous ? maskedSchedule(readingTuesday) : readingTuesday) })
    renderBoard(board)
    fireEvent.click(await block(interimLabel))
    const inspector = await findInspector()
    expect(await within(inspector).findByRole("link", { name: "sophie.turner@example.com" })).toBeInTheDocument()
    await waitFor(() => expect(within(inspector).getByRole("heading", { level: 2 })).toHaveFocus())

    me = anonymous
    refocus()

    await waitFor(() => expect(queryInspector()).not.toBeInTheDocument())
    expect(inspector).not.toBeInTheDocument()
    expect(screen.queryByText("sophie.turner@example.com")).not.toBeInTheDocument()
    // Never the page's body: the block (or the board, once the masked day has replaced it).
    expect(document.activeElement).not.toBe(document.body)
    expect(screen.getByRole("region", { name: reading.name })).toContainElement(document.activeElement as HTMLElement)
  })

  it("leave another booking's details open when a cancellation answers after it was chosen", async () => {
    const answer = deferred<AppointmentResponse>()
    const api = mockBoardApi({ cancel: () => answer.promise })
    renderBoard(board)
    fireEvent.click(await block(interimLabel))
    const inspector = await findInspector()
    fireEvent.change(startCancelling(inspector), { target: { value: "Customer rang" } })
    fireEvent.click(within(inspector).getByRole("button", { name: "Cancel appointment" }))
    await waitFor(() => expect(cancels(api.requests)).toHaveLength(1))

    fireEvent.click(screen.getByRole("button", { name: brakesLabel }))
    await within(inspector).findByRole("heading", { level: 2, name: "Brake Pads & Discs" })
    answer.release({ ...interimDetails, status: "Cancelled", cancellationReason: "Customer rang" })

    expect(await screen.findByText("Appointment cancelled")).toBeInTheDocument()
    expect(within(await findInspector()).getByRole("heading", { level: 2, name: "Brake Pads & Discs" })).toBeInTheDocument()
  })
})

describe("cancelling from the details: a short confirm", () => {
  it("opens on Cancel booking…, with focus in the reason, and sends nothing yet", async () => {
    const api = mockBoardApi()
    renderBoard(board)
    fireEvent.click(await block(interimLabel))
    const inspector = await findInspector()

    const reason = startCancelling(inspector)

    await waitFor(() => expect(reason).toHaveFocus())
    const confirm = within(inspector).getByRole("form", { name: "Cancel this booking?" })
    expect(confirm).toHaveTextContent("Bay 1 - Standard and Amelia Clarke become free at 08:00.")
    expect(within(confirm).getByText("0/500")).toBeInTheDocument()
    expect(confirm).toContainElement(reason)
    // The confirm's words scroll with the cards; its buttons are pinned under them and submit its form from there.
    const { body, actions } = partsOf(inspector)
    expect(scrollingParts(inspector)).toEqual([body])
    expect(body).toContainElement(confirm)
    expect(body.firstElementChild!.lastElementChild).toBe(confirm)
    expect(body).toContainElement(within(inspector).getByRole("heading", { level: 3, name: "Job" }))
    const keep = within(inspector).getByRole("button", { name: "Keep booking" })
    const submit = within(inspector).getByRole<HTMLButtonElement>("button", { name: "Cancel appointment" })
    expect(actions).toContainElement(keep)
    expect(actions).toContainElement(submit)
    expect(body).not.toContainElement(submit)
    expect(submit.form).toBe(confirm)
    expect(within(inspector).queryByRole("button", { name: "Cancel booking…" })).not.toBeInTheDocument()
    expect(cancels(api.requests)).toHaveLength(0)
  })

  it.each([
    { motion: "smooth", reduced: false },
    { motion: "at once", reduced: true },
  ])("brings the confirm into view by scrolling the cards alone, $motion", async ({ reduced }) => {
    mockBoardApi()
    renderBoard(board)
    fireEvent.click(await block(interimLabel))
    const inspector = await findInspector()
    const { body } = partsOf(inspector)
    if (reduced) preferReducedMotion(1440)
    // A short inspector: the cards' part is 160 px tall and scrolled to the top, and the confirm will be drawn at 560 px
    // in its content, 150 px tall (jsdom has no layout, so the geometry is given).
    const scrolled = layOut(body, { room: 160, content: 726, confirm: { top: 560, height: 150, field: { top: 52, height: 98 } } })
    const page = vi.spyOn(window, "scrollTo").mockImplementation(() => {})

    const reason = startCancelling(inspector)

    await waitFor(() => expect(reason).toHaveFocus())
    // The least scroll that shows all of it, with what room is left split above and below (5 px each side).
    expect(scrolled).toHaveBeenCalledWith({ top: 555, behavior: reduced ? "instant" : "smooth" })
    expect(page).not.toHaveBeenCalled()
  })

  it("shows its prompt down to the reason when the cards have no room for all of it, else the reason alone", async () => {
    mockBoardApi()
    renderBoard(board)
    fireEvent.click(await block(interimLabel))
    const inspector = await findInspector()
    // 160 px of room: not enough for the whole confirm (190 px), enough for its prompt down to the reason (52 + 98 px).
    const scrolled = layOut(partsOf(inspector).body, { room: 160, content: 766, confirm: { top: 560, height: 190, field: { top: 52, height: 98 } } })

    startCancelling(inspector)

    // From the prompt's top (560) to the reason's foot (710), 5 px clear of each edge.
    await waitFor(() => expect(scrolled).toHaveBeenCalledWith({ top: 555, behavior: "smooth" }))
  })

  it("keeps the open confirm in view while focus is in it, as the cards above it grow or the part gets shorter", async () => {
    const observers: ResizeObserverCallback[] = []
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          observers.push(callback)
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    try {
      mockBoardApi()
      renderBoard(board)
      fireEvent.click(await block(interimLabel))
      const inspector = await findInspector()
      const geometry: Geometry = { room: 160, content: 726, confirm: { top: 560, height: 150, field: { top: 52, height: 98 } } }
      const scrolled = layOut(partsOf(inspector).body, geometry)
      const before = observers.length
      const resized = () => act(() => observers.slice(before).forEach((notify) => notify([], {} as ResizeObserver)))
      const reason = startCancelling(inspector)
      await waitFor(() => expect(scrolled).toHaveBeenCalledWith({ top: 555, behavior: "smooth" }))
      await waitFor(() => expect(reason).toHaveFocus())

      // The whole record arrives: the cards above grow by 100 px and push the confirm down, out of view.
      geometry.confirm.top = 660
      geometry.content = 826
      resized()
      expect(scrolled).toHaveBeenLastCalledWith({ top: 655, behavior: "instant" })

      // The part gets 10 px shorter (the page scrolled back up): the confirm's foot would drop out of view.
      geometry.room = 150
      resized()
      expect(scrolled).toHaveBeenLastCalledWith({ top: 660, behavior: "instant" })

      // With focus elsewhere, the cards stay where the person put them.
      const calls = scrolled.mock.calls.length
      within(inspector).getByRole("button", { name: "Copy appointment reference" }).focus()
      geometry.confirm.top = 760
      geometry.content = 926
      resized()
      expect(scrolled).toHaveBeenCalledTimes(calls)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("shows the reason alone when the cards have no room for its prompt as well", async () => {
    mockBoardApi()
    renderBoard(board)
    fireEvent.click(await block(interimLabel))
    const inspector = await findInspector()
    // 120 px of room: not enough for the confirm (150 px) nor for its prompt down to the reason (52 + 98 px).
    const scrolled = layOut(partsOf(inspector).body, { room: 120, content: 726, confirm: { top: 560, height: 150, field: { top: 52, height: 98 } } })

    startCancelling(inspector)

    // The reason's label, counter and field (612 to 710), 11 px clear of each edge: the field to type in comes first.
    await waitFor(() => expect(scrolled).toHaveBeenCalledWith({ top: 601, behavior: "smooth" }))
  })

  it("keeps the booking: the confirm closes, focus returns to Cancel booking… and the reason is not kept", async () => {
    const api = mockBoardApi()
    renderBoard(board)
    fireEvent.click(await block(interimLabel))
    const inspector = await findInspector()
    fireEvent.change(startCancelling(inspector), { target: { value: "Typed, then thought better of" } })

    fireEvent.click(within(inspector).getByRole("button", { name: "Keep booking" }))

    await waitFor(() => expect(within(inspector).getByRole("button", { name: "Cancel booking…" })).toHaveFocus())
    expect(within(inspector).queryByRole("form", { name: "Cancel this booking?" })).not.toBeInTheDocument()
    expect(startCancelling(inspector)).toHaveValue("")
    expect(cancels(api.requests)).toHaveLength(0)
  })

  it("cancels with the reason given, and the details close as the block leaves the board", async () => {
    let cancelled = false
    const api = mockBoardApi({
      schedule: () => (cancelled ? without(readingTuesday, appointments.interim.id) : readingTuesday),
      cancel: (_, body) => {
        cancelled = true
        return { ...interimDetails, status: "Cancelled", cancellationReason: String(body.reason) }
      },
    })
    renderBoard(board)
    fireEvent.click(await block(interimLabel))
    const inspector = await findInspector()
    const reason = startCancelling(inspector)
    fireEvent.change(reason, { target: { value: "  Customer rang to rearrange  " } })
    expect(within(inspector).getByText("30/500")).toBeInTheDocument()

    fireEvent.click(within(inspector).getByRole("button", { name: "Cancel appointment" }))

    expect(await screen.findByText("Appointment cancelled")).toBeInTheDocument()
    expect(await cancels(api.requests)[0].clone().json()).toEqual({ reason: "Customer rang to rearrange" })
    await waitFor(() => expect(queryInspector()).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByRole("button", { name: interimLabel })).not.toBeInTheDocument())
    expect(screen.getByRole("region", { name: reading.name })).toContainElement(document.activeElement as HTMLElement)
  })

  it("asks for the reason when there is none, keeping the booking and sending nothing", async () => {
    const api = mockBoardApi()
    renderBoard(board)
    fireEvent.click(await block(interimLabel))
    const inspector = await findInspector()
    const reason = startCancelling(inspector)

    fireEvent.click(within(inspector).getByRole("button", { name: "Cancel appointment" }))

    expect(await within(inspector).findByText("Say why the appointment is cancelled.")).toBeInTheDocument()
    expect(reason).toHaveAttribute("aria-invalid", "true")
    expect(reason).toHaveFocus()
    expect(cancels(api.requests)).toHaveLength(0)
    expect(queryInspector()).toBeInTheDocument()
  })

  it("shows a Viewer Cancel booking… unavailable with the reason, and no confirm", async () => {
    const { requests } = mockBoardApi({ me: () => viewer })
    renderBoard(board)
    fireEvent.click(await block(interimLabel))
    const inspector = await findInspector()

    const start = within(inspector).getByRole("button", { name: "Cancel booking…" })
    expect(start).toHaveAttribute("aria-disabled", "true")
    const why = document.getElementById(start.getAttribute("aria-describedby")!)
    expect(why).toHaveTextContent("Your role can view bookings but not change them.")
    // The reason scrolls with the cards, right above the pinned button.
    const { body, actions } = partsOf(inspector)
    expect(body).toContainElement(why)
    expect(actions).toContainElement(start)
    fireEvent.click(start)
    expect(within(inspector).queryByRole("textbox", { name: "Reason" })).not.toBeInTheDocument()
    expect(cancels(requests)).toHaveLength(0)
  })
})

describe.each([
  { width: 1024, side: "right" },
  { width: 390, side: "bottom" },
])("a booking's details at $width px", ({ width, side }) => {
  beforeEach(() => viewportOf(width))

  it(`open in the ${side} sheet with the same cards and the confirm`, async () => {
    mockBoardApi()
    renderBoard(board)

    // The agenda's card on a phone names the customer too.
    fireEvent.click(await block(width < 768 ? /^Interim Service, Bay 1 - Standard, 08:00 to 09:00/ : interimLabel))

    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    expect(sheet).toHaveAttribute("data-side", side)
    expect(sheet).toHaveAccessibleDescription("Tuesday 13 October 2026, 08:00–09:00 (Europe/London)")
    expect(queryInspector()).not.toBeInTheDocument()
    for (const card of ["Job", "Customer", "Vehicle"]) {
      expect(within(sheet).getByRole("heading", { level: 3, name: card })).toBeInTheDocument()
    }
    await waitFor(() => expect(startCancelling(sheet)).toHaveFocus())
    // The same parts as the inspector: one scrolling part with the confirm in it, the buttons pinned under it.
    const { body, actions } = partsOf(sheet)
    expect(scrollingParts(sheet)).toEqual([body])
    expect(body).toContainElement(within(sheet).getByRole("form", { name: "Cancel this booking?" }))
    expect(actions).toContainElement(within(sheet).getByRole("button", { name: "Keep booking" }))
    expect(actions).toContainElement(within(sheet).getByRole("button", { name: "Cancel appointment" }))
  })
})

/** The details' scrolling part and its pinned action row. */
function partsOf(details: HTMLElement) {
  return {
    body: details.querySelector<HTMLElement>('[data-slot="details-body"]')!,
    actions: details.querySelector<HTMLElement>('[data-slot="details-actions"]')!,
  }
}

/** Every element of the details that scrolls its content (the reason's own textarea aside): there must be one. */
function scrollingParts(details: HTMLElement) {
  return [...details.querySelectorAll<HTMLElement>("*")].filter(
    (element) => element.tagName !== "TEXTAREA" && /(^|\s)(overflow|overflow-y)-(auto|scroll)(\s|$)/.test(element.className)
  )
}

/** From now on, the person asks for reduced motion, on a viewport this wide. */
function preferReducedMotion(width: number) {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: query.includes("(prefers-reduced-motion: reduce)") || matchesWidth(query, width),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}

interface Geometry {
  /** The scrolling part's height, and its content's. */
  room: number
  content: number
  /** Where the confirm (a form, and in it its prompt and its reason field) is drawn in that content. */
  confirm: { top: number; height: number; field: { top: number; height: number } }
}

/**
 * Gives the details' scrolling part a layout (jsdom has none), read from `geometry` as it is at each call, so a test can
 * change it. Returns the part's `scrollTo`, which scrolls it.
 */
function layOut(body: HTMLElement, geometry: Geometry) {
  let scrollTop = 0
  Object.defineProperty(body, "clientHeight", { configurable: true, get: () => geometry.room })
  Object.defineProperty(body, "scrollHeight", { configurable: true, get: () => geometry.content })
  Object.defineProperty(body, "scrollTop", { configurable: true, get: () => scrollTop, set: (value: number) => (scrollTop = value) })
  const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top }) as DOMRect
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const { room, content, confirm } = geometry
    const form = this.closest("form")
    const start = confirm.top - scrollTop
    if (this === body) return rect(0, room)
    if (this === body.firstElementChild) return rect(-scrollTop, content)
    if (this instanceof HTMLFormElement) return rect(start, confirm.height)
    if (form && this === form.firstElementChild) return rect(start, 40)
    if (form && this.getAttribute("data-slot") === "field") return rect(start + confirm.field.top, confirm.field.height)
    return rect(0, 0)
  })
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    scrollTop = options.top ?? scrollTop
  })
  Object.defineProperty(body, "scrollTo", { configurable: true, value: scrollTo })
  return scrollTo
}

/** Every docked inspector on the page (there is only ever one). */
function findAllInspectors() {
  return screen.queryAllByRole("complementary", { name: "Appointment details" })
}
