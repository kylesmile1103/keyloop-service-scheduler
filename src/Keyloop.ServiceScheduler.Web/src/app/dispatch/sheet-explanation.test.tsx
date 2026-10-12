import { fireEvent, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { mockBoardApi, requestsTo } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { serviceAdvisor } from "@/test/identities"
import { renderBoard } from "@/test/render-board"
import { interimDetails, technicians } from "@/test/schedules"
import { allocation, readingTuesdayWithCompetence, vehicleAwareOn } from "@/test/vehicle"

// The details sheet's "Why this allocation" names a preference the allocation did not follow from the day's bays and
// technicians (Task 31b merged with Task 28b): on the board, the Overview and the Calendar alike, the sheet reads the
// appointment's own day's schedule for it, only when the record says a preference was not followed.

beforeAll(async () => {
  await Promise.all([import("@/app/dispatch/page"), import("@/app/overview/page"), import("@/app/calendar/page")])
})

beforeEach(() => {
  // Tuesday 2026-10-13, 07:30 in Reading (BST), before the day's first appointment. Only Date is faked.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T06:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

const interim = /^Interim Service, Bay 1 - Standard, 08:00 to 09:00/
/** Tuesday's interim service: the board's block, the Overview's upcoming row, the chip in the Calendar's Tuesday. */
const pages = [
  { page: "the board", path: `/dispatch?dealership=${reading.id}`, opener: () => screen.findByRole("button", { name: interim }) },
  {
    page: "the Overview",
    path: `/overview?dealership=${reading.id}`,
    opener: () => screen.findByRole("button", { name: /^Today, Interim Service, Bay 1 - Standard, 08:00 to 09:00/ }),
  },
  {
    page: "the Calendar",
    path: `/calendar?dealership=${reading.id}`,
    opener: async () => {
      const tuesday = (await screen.findByRole("heading", { level: 3, name: "Tuesday 13 October, today, dispatch board" })).closest("li")!
      return within(tuesday).findByRole("button", { name: interim })
    },
  },
] as const

/** Amelia Clarke, where Farid Haddad (level 1) was asked for and the job needed level 2. */
const notAsAsked = {
  ...interimDetails,
  allocation: allocation({
    decidedBy: "OnlyQualifiedResource",
    minimumHvLevel: 2,
    firedRules: ["hv-routine"],
    reasons: ["preferred-technician:minimum-hv-level"],
    preferredTechnicianId: technicians.farid.id,
  }),
}

/** The same booking, every preference followed. */
const asAsked = { ...interimDetails, allocation: allocation({ decidedBy: "PreferredResource", preferredTechnicianId: technicians.amelia.id }) }

const scheduleReads = (requests: readonly Request[]) => requestsTo(requests, "/schedule").map((request) => new URL(request.url).search)

/** Opens the interim service's sheet once the page has drawn it, after `beforeClick` (the page's own reads are out by then). */
async function openSheet(opener: () => Promise<HTMLElement>, beforeClick: () => void = () => {}) {
  const button = await opener()
  beforeClick()
  fireEvent.click(button)
  return screen.findByRole("dialog", { name: "Interim Service" })
}

describe.each(pages)("the details sheet on $page", ({ path, opener }) => {
  it("names the technician asked for, with their HV level, from the appointment's day", async () => {
    const api = mockBoardApi({
      features: () => vehicleAwareOn,
      me: () => serviceAdvisor,
      schedule: () => readingTuesdayWithCompetence,
      appointment: () => notAsAsked,
    })
    renderBoard(path)
    const sheet = await openSheet(opener)

    const why = await within(sheet).findByRole("region", { name: "Why this allocation" })
    expect(await within(why).findByText("Farid Haddad holds HV level 1, below the level 2 this job needs.")).toBeInTheDocument()
    expect(scheduleReads(api.requests)).toContain("?date=2026-10-13")
  })

  it("reads no schedule for it when every preference was followed", async () => {
    const api = mockBoardApi({
      features: () => vehicleAwareOn,
      me: () => serviceAdvisor,
      schedule: () => readingTuesdayWithCompetence,
      appointment: () => asAsked,
    })
    renderBoard(path)
    let before = 0
    const sheet = await openSheet(opener, () => (before = scheduleReads(api.requests).length))

    await within(sheet).findByRole("region", { name: "Why this allocation" })
    expect(within(sheet).queryByText("Not as you asked")).not.toBeInTheDocument()
    expect(scheduleReads(api.requests)).toHaveLength(before)
  })
})
