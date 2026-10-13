import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { AppointmentResponse, CurrentUserResponse } from "@/api/types.gen"
import { mockBoardApi, requestsTo } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { findInspector, queryInspector, startCancelling } from "@/test/details"
import { admin, anonymous, viewer } from "@/test/identities"
import { deferred, maskedSchedule, refocus } from "@/test/identity-change"
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
    expect(within(confirm).getByRole("button", { name: "Keep booking" })).toBeInTheDocument()
    expect(within(confirm).getByRole("button", { name: "Cancel appointment" })).toBeInTheDocument()
    expect(within(inspector).queryByRole("button", { name: "Cancel booking…" })).not.toBeInTheDocument()
    expect(cancels(api.requests)).toHaveLength(0)
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
    expect(document.getElementById(start.getAttribute("aria-describedby")!)).toHaveTextContent("Your role can view bookings but not change them.")
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
    expect(within(sheet).getByRole("button", { name: "Keep booking" })).toBeInTheDocument()
  })
})

/** Every docked inspector on the page (there is only ever one). */
function findAllInspectors() {
  return screen.queryAllByRole("complementary", { name: "Appointment details" })
}
