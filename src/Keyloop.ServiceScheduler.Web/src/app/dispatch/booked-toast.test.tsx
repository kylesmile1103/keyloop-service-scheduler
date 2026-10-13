import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { BookAppointmentRequest } from "@/api/types.gen"
import { currentUserQueryKey } from "@/lib/session"
import { bookedFrom, mockBoardApi } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { serviceAdvisor, viewer } from "@/test/identities"
import { pointerClick, renderBoard } from "@/test/render-board"
import { bays, interimServiceType, technicians } from "@/test/schedules"
import { allocation, decodedVolkswagen, readingTuesdayWithCompetence, vehicleAwareOff, vehicleAwareOn } from "@/test/vehicle"

// Wide-screen booking confirmation toast: shows allocation explanation when vehicle-aware requirements are enabled
// and dismisses when caller identity changes.

beforeAll(async () => {
  await Promise.all([import("@/app/dispatch/page"), import("@/app/overview/page"), import("@/app/calendar/page")])
})

beforeEach(() => {
  // Tuesday 2026-10-13, 09:30 in Reading (BST). Only Date is faked; timers stay real for the UI.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

const pages = [
  { page: "the board", path: `/dispatch?dealership=${reading.id}`, book: "Book appointment" },
  { page: "the Overview", path: `/overview?dealership=${reading.id}`, book: "Book appointment" },
  { page: "the Calendar", path: `/calendar?dealership=${reading.id}`, book: "New appointment on Tuesday 13 October" },
] as const

/** Amelia Clarke at level 2 for a declared electric car, where Farid Haddad (level 1) was asked for. */
const explainedBooking = (body: BookAppointmentRequest) => ({
  ...bookedFrom(body, { bay: bays.standard, technician: technicians.amelia }),
  vehicle: {
    ...bookedFrom(body).vehicle,
    profile: { ...decodedVolkswagen, powertrain: "BatteryElectric" as const, provenance: { ...decodedVolkswagen.provenance, powertrain: "Declared" as const } },
  },
  allocation: allocation({
    decidedBy: "OnlyQualifiedResource",
    minimumHvLevel: 2,
    firedRules: ["hv-routine"],
    reasons: ["preferred-technician:minimum-hv-level"],
    preferredTechnicianId: technicians.farid.id,
  }),
})

/** Books Interim Service at 10:15 on Tuesday from the page's Book action, asking for Farid Haddad; returns the toast. */
async function bookFrom(book: string) {
  fireEvent.click(await screen.findByRole("button", { name: book }))
  const dialog = await screen.findByRole("dialog", { name: "Book appointment" })
  fireEvent.click(await within(dialog).findByRole("combobox", { name: "Service" }))
  pointerClick(await screen.findByRole("option", { name: /^Interim Service/ }))
  fireEvent.click(await within(dialog).findByRole("radio", { name: /^10:15/ }))
  fireEvent.click(within(dialog).getByRole("button", { name: "Next" }))
  await within(dialog).findByRole("heading", { name: "Customer and vehicle" })
  const values = { Name: "Grace Hopper", Email: "grace@example.com", Phone: "+44 7700 900123", VIN: "WVWZZZ1KZAW654321", Registration: "RK22 ABC", Make: "Volkswagen", Model: "Golf" }
  for (const [label, value] of Object.entries(values)) fireEvent.change(within(dialog).getByRole("textbox", { name: label }), { target: { value } })
  fireEvent.click(within(dialog).getByRole("combobox", { name: "Preferred technician" }))
  pointerClick(await screen.findByRole("option", { name: /^Farid Haddad/ }))
  fireEvent.click(within(dialog).getByRole("button", { name: "Book" }))
  return (await screen.findByText("Booked")).closest<HTMLElement>("[data-slot=toast]")!
}

describe.each(pages)("a booking made from $page", ({ path, book }) => {
  it("is explained in a stacked toast: why this technician, and why not the one asked for, named from the day's roster", async () => {
    mockBoardApi({
      features: () => vehicleAwareOn,
      me: () => serviceAdvisor,
      serviceTypes: () => [interimServiceType],
      schedule: () => readingTuesdayWithCompetence,
      book: (_, body) => explainedBooking(body),
    })
    renderBoard(path)

    const toast = await bookFrom(book)
    expect(toast).toHaveTextContent("Interim Service at 10:15 · Bay 1 - Standard · Amelia Clarke")
    expect(toast).toHaveTextContent(
      "Amelia Clarke: the only free technician at HV level 2 or above with General service, for a battery-electric vehicle (declared)."
    )
    expect(toast).toHaveTextContent("Farid Haddad holds HV level 1, below the level 2 this job needs.")
    // The sentence takes the toast's whole width, with View on board under it.
    expect(toast).toHaveAttribute("data-stacked")
    expect(within(toast).getByRole("button", { name: "View on board" })).toBeInTheDocument()
  })

  it("closes that toast when who is signed in changes, as it names technicians' levels", async () => {
    mockBoardApi({
      features: () => vehicleAwareOn,
      me: () => serviceAdvisor,
      serviceTypes: () => [interimServiceType],
      schedule: () => readingTuesdayWithCompetence,
      book: (_, body) => explainedBooking(body),
    })
    const { queryClient } = renderBoard(path)

    const toast = await bookFrom(book)
    expect(toast).toBeInTheDocument()
    act(() => queryClient.setQueryData(currentUserQueryKey(), viewer))
    await waitFor(() => expect(screen.queryByText("Booked")).not.toBeInTheDocument())
  })

  it("is today's one-line toast with vehicle-aware requirements off", async () => {
    mockBoardApi({
      features: () => vehicleAwareOff,
      me: () => serviceAdvisor,
      serviceTypes: () => [interimServiceType],
      schedule: () => readingTuesdayWithCompetence,
      book: (_, body) => bookedFrom(body, { bay: bays.standard, technician: technicians.amelia }),
    })
    renderBoard(path)

    const toast = await bookFrom(book)
    expect(toast).toHaveTextContent("Interim Service at 10:15 · Bay 1 - Standard · Amelia Clarke")
    expect(toast).not.toHaveTextContent("the only free technician")
    expect(toast).not.toHaveAttribute("data-stacked")
  })
})
