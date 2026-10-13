import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { listAppointmentsQueryKey } from "@/api/@tanstack/react-query.gen"
import type { ListAppointmentsData } from "@/api/types.gen"
import { mockBoardApi } from "@/test/board-api"
import { munich, reading } from "@/test/dealerships"
import { findInspector, startCancelling } from "@/test/details"
import { problemResponse } from "@/test/mock-api"
import { pointerClick, renderBoard } from "@/test/render-board"
import { interimServiceType } from "@/test/schedules"

// The Overview and the Calendar read a dealership's appointments by date range (`GET /appointments?from=&to=`). A booking or
// a cancellation made anywhere (the board's dialog and details sheet are the ones every page opens) marks that
// dealership's range reads stale, so those pages read again instead of showing the slot as it was.

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

const rangeKey = (dealershipId: string, from: string, to: string) =>
  listAppointmentsQueryKey({ path: { dealershipId }, query: { from, to } as ListAppointmentsData["query"] })

const readingWeek = rangeKey(reading.id, "2026-10-12", "2026-10-18")
const readingFortnight = rangeKey(reading.id, "2026-09-29", "2026-10-27")
const munichWeek = rangeKey(munich.id, "2026-10-12", "2026-10-18")

/** A cache in which the Calendar and the Overview have read both dealerships' ranges. */
function seedRanges(queryClient: ReturnType<typeof renderBoard>["queryClient"]) {
  for (const key of [readingWeek, readingFortnight, munichWeek]) queryClient.setQueryData(key, [])
}

const stale = (queryClient: ReturnType<typeof renderBoard>["queryClient"], key: readonly unknown[]) =>
  queryClient.getQueryState(key)?.isInvalidated

describe("range reads after a change on the board", () => {
  it("marks the dealership's range reads stale after a booking, and leaves other dealerships' alone", async () => {
    mockBoardApi({ serviceTypes: () => [interimServiceType] })
    const { queryClient } = renderBoard(`/dispatch?dealership=${reading.id}`)
    seedRanges(queryClient)

    fireEvent.click(await screen.findByRole("button", { name: "Book appointment" }))
    const dialog = await screen.findByRole("dialog", { name: "Book appointment" })
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Service" }))
    pointerClick(await screen.findByRole("option", { name: /^Interim Service/ }))
    fireEvent.click(await within(dialog).findByRole("radio", { name: "10:15, 4 bays and 3 technicians free" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }))
    await within(dialog).findByRole("heading", { name: "Customer and vehicle" })
    const values = { Name: "Grace Hopper", Email: "grace@example.com", Phone: "+44 7700 900123", VIN: "WVWZZZ1KZAW654321", Registration: "RK22 ABC", Make: "Volkswagen", Model: "Golf" }
    for (const [label, value] of Object.entries(values)) fireEvent.change(within(dialog).getByRole("textbox", { name: label }), { target: { value } })
    expect([stale(queryClient, readingWeek), stale(queryClient, readingFortnight)]).toEqual([false, false])

    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))

    await screen.findByText("Booked")
    expect([stale(queryClient, readingWeek), stale(queryClient, readingFortnight)]).toEqual([true, true])
    expect(stale(queryClient, munichWeek)).toBe(false)
  })

  it("marks them stale after a cancellation", async () => {
    mockBoardApi()
    const { queryClient } = renderBoard(`/dispatch?dealership=${reading.id}`)
    seedRanges(queryClient)

    fireEvent.click(await screen.findByRole("button", { name: "Interim Service, Bay 1 - Standard, 08:00 to 09:00, Amelia Clarke, Confirmed" }))
    const sheet = await findInspector()
    fireEvent.change(startCancelling(sheet), { target: { value: "Customer rang to rearrange" } })
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel appointment" }))

    await screen.findByText("Appointment cancelled")
    expect([stale(queryClient, readingWeek), stale(queryClient, readingFortnight)]).toEqual([true, true])
    expect(stale(queryClient, munichWeek)).toBe(false)
  })

  it("marks them stale when a cancellation finds the appointment already changed", async () => {
    mockBoardApi({
      cancel: () =>
        problemResponse(409, {
          type: "https://api.keyloop.example/problems/invalid-state-transition",
          title: "Invalid state transition",
          status: 409,
          detail: "An appointment that is InProgress cannot be cancelled.",
          traceId: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        }),
    })
    const { queryClient } = renderBoard(`/dispatch?dealership=${reading.id}`)
    seedRanges(queryClient)

    fireEvent.click(await screen.findByRole("button", { name: "Interim Service, Bay 1 - Standard, 08:00 to 09:00, Amelia Clarke, Confirmed" }))
    const sheet = await findInspector()
    fireEvent.change(startCancelling(sheet), { target: { value: "Customer rang to rearrange" } })
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel appointment" }))

    await within(sheet).findByText("Invalid state transition")
    await waitFor(() => expect(stale(queryClient, readingWeek)).toBe(true))
    expect(stale(queryClient, munichWeek)).toBe(false)
  })
})
