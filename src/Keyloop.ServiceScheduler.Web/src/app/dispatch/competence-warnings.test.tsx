import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { CompetenceWarningResponse, CurrentUserResponse, WorkshopScheduleResponse } from "@/api/types.gen"
import { COMPETENCE_REASONS, competenceReason } from "@/lib/competence-warnings"
import { detailsFor, mockBoardApi } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { findInspector } from "@/test/details"
import { admin, anonymous, serviceAdvisor, viewer } from "@/test/identities"
import { maskedSchedule } from "@/test/identity-change"
import { renderBoard, viewportOf } from "@/test/render-board"
import { appointments, bays, readingTuesday } from "@/test/schedules"
import { vehicleAwareOn } from "@/test/vehicle"

// Competence warnings on the board: flags appointments whose technician or bay no longer meets booked requirements.
// Visitors never see competence warnings.

beforeAll(async () => {
  await import("@/app/dispatch/page")
})

beforeEach(() => {
  // Tuesday 2026-10-13, 07:30 in Reading (BST). Only Date is faked.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T06:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

const board = `/dispatch?dealership=${reading.id}`

const benInactive: CompetenceWarningResponse = { requiresReview: true, reasonCodes: ["technician-inactive"] }
const ameliaAndBay: CompetenceWarningResponse = { requiresReview: true, reasonCodes: ["technician-hv-level-lowered", "bay-capability-removed"] }

/** Reading's Tuesday as a role reads it once Ben Okafor was deactivated and Amelia's level and Bay 1's equipment lowered. */
const flagged: WorkshopScheduleResponse = {
  ...readingTuesday,
  bays: readingTuesday.bays.map((bay) => ({
    ...bay,
    appointments: bay.appointments.map((appointment) =>
      appointment.id === appointments.evBattery.id
        ? { ...appointment, competenceWarning: benInactive }
        : appointment.id === appointments.interim.id
          ? { ...appointment, competenceWarning: ameliaAndBay }
          : appointment
    ),
  })),
}

/** The API's answer for each caller: the warnings to a role, the masked schedule without them to a visitor. */
function api(me: CurrentUserResponse, schedule: (signedIn: boolean) => WorkshopScheduleResponse = (signedIn) => (signedIn ? flagged : maskedSchedule(readingTuesday))) {
  return mockBoardApi({
    me: () => me,
    features: () => vehicleAwareOn,
    schedule: () => schedule(me.roles.length > 0),
    appointment: (id) => {
      const bay = flagged.bays.find((candidate) => candidate.appointments.some((appointment) => appointment.id === id))!
      const appointment = bay.appointments.find((candidate) => candidate.id === id)!
      return { ...detailsFor(appointment, { id: bay.id, name: bay.name }), competenceWarning: appointment.competenceWarning ?? null }
    },
  })
}

const evLabel = "EV Battery Health Check, Bay 4 - EV, 09:00 to 10:00, Ben Okafor, Confirmed"

describe("competence warnings on the board", () => {
  it.each([
    ["an Admin", admin],
    ["a Service advisor", serviceAdvisor],
    ["a Viewer", viewer],
  ])("marks a flagged block for %s, says so in its label and sums the day up", async (_, me) => {
    api(me)
    renderBoard(board)

    const block = await screen.findByRole("button", { name: `${evLabel}, needs review` })
    expect(within(block).getByText("Review")).toBeInTheDocument()
    // An appointment that still qualifies is not marked.
    const mot = screen.getByRole("button", { name: "MOT Test, Bay 6 - MOT, 11:00 to 11:45, Farid Haddad, Confirmed" })
    expect(within(mot).queryByText("Review")).not.toBeInTheDocument()
    expect(screen.getByText("2 appointments need review: their technician or bay no longer meets what they were booked with.")).toBeInTheDocument()
    expect(screen.getByRole("list", { name: "Status legend" })).toHaveTextContent("Needs review: its technician or bay no longer qualifies")
  })

  it("names every reason in the details, with the people and bay concerned, and moves nothing", async () => {
    api(serviceAdvisor)
    renderBoard(board)

    fireEvent.click(await screen.findByRole("button", { name: /^Interim Service, Bay 1 - Standard, 08:00 to 09:00, Amelia Clarke, Confirmed, needs review$/ }))
    const sheet = await findInspector()
    const review = await within(sheet).findByRole("region", { name: "Needs review" })
    expect(review).toHaveTextContent("Amelia Clarke's HV level is now below the level this job needs.")
    expect(review).toHaveTextContent(`${bays.standard.name} no longer has equipment this job needs.`)
    expect(review).toHaveTextContent("Nothing has been moved")
    // The details still show the booking as it is: same bay, technician and time; the notice heads the Job card.
    expect(within(review.closest<HTMLElement>('[data-slot="details-card"]')!).getByRole("heading", { level: 3, name: "Job" })).toBeInTheDocument()
    expect(within(sheet).getByText(bays.standard.name)).toBeInTheDocument()
  })

  it("marks a flagged job card on a phone", async () => {
    viewportOf(390)
    api(admin)
    renderBoard(board)

    const card = await screen.findByRole("button", { name: /^EV Battery Health Check, Bay 4 - EV, 09:00 to 10:00, .*, Ben Okafor, Confirmed, needs review$/ })
    expect(within(card).getByText("Needs review")).toBeInTheDocument()
  })

  it("shows none to a visitor: the API omits them, and the board leaves out any it still holds", async () => {
    api(anonymous)
    renderBoard(board)

    await screen.findByRole("button", { name: evLabel })
    expect(screen.queryByText(/need review/)).not.toBeInTheDocument()
    expect(screen.queryByText("Review")).not.toBeInTheDocument()
    expect(screen.getByRole("list", { name: "Status legend" })).not.toHaveTextContent("Needs review")
  })

  it("shows none to a visitor even when an answer carried one", async () => {
    api(anonymous, () => flagged)
    renderBoard(board)

    expect(await screen.findByRole("button", { name: evLabel })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText("Review")).not.toBeInTheDocument())
    expect(screen.queryByText(/need review/)).not.toBeInTheDocument()
  })
})

describe("the warnings' words", () => {
  it("say every reason code the contract has, naming who or what it is about", () => {
    const context = { technician: "Ben Okafor", bay: "Bay 4 - EV", day: "Tuesday 13 October 2026" }
    expect(COMPETENCE_REASONS).toEqual([
      "technician-inactive",
      "technician-certification-removed",
      "technician-hv-expired",
      "technician-hv-level-lowered",
      "bay-inactive",
      "bay-capability-removed",
    ])
    for (const code of COMPETENCE_REASONS) {
      const words = competenceReason(code, context)
      expect(words).toMatch(code.startsWith("bay-") ? /Bay 4 - EV/ : /Ben Okafor/)
      expect(words).not.toContain(code)
    }
    expect(competenceReason("technician-hv-expired", context)).toBe("Ben Okafor's HV level is no longer valid on Tuesday 13 October 2026.")
    expect(competenceReason("some-new-code", context)).toContain("some-new-code")
  })
})
