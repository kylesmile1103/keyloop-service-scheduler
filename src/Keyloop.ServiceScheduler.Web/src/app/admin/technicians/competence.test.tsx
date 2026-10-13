import { fireEvent, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { WorkshopScheduleResponse } from "@/api/types.gen"
import { mockBoardApi } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { renderBoard, viewportOf } from "@/test/render-board"
import { columnTexts, headers, openFilter } from "@/test/resource-list"
import { readingTuesday, technicians } from "@/test/schedules"
import { readingTuesdayWithCompetence, vehicleAwareOff, vehicleAwareOn } from "@/test/vehicle"

beforeAll(async () => {
  await Promise.all([import("@/app/admin/layout"), import("@/app/admin/technicians/page")])
})

beforeEach(() => {
  // Tuesday 2026-10-13, 09:30 in Reading (BST). Only Date is faked; timers stay real for the UI.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

const page = `/resources/technicians?dealership=${reading.id}`
const table = () => screen.findByRole("table", { name: "Technicians" })

/**
 * An upgraded developer database: the migration carried Ben's and Eva's old HV certificate over as level 3, everyone else
 * as level 0, none of it confirmed; and Farid's level 1 expired yesterday.
 */
const migrated: WorkshopScheduleResponse = {
  ...readingTuesdayWithCompetence,
  technicians: readingTuesdayWithCompetence.technicians.map((technician) => {
    if (technician.id === technicians.ben.id || technician.id === technicians.eva.id) {
      return { ...technician, hvLevel: 3, hvLevelValidUntil: null, hvLevelConfirmed: false, brandSpecialisms: [] }
    }
    if (technician.id === technicians.farid.id) return { ...technician, hvLevel: 1, hvLevelValidUntil: "2026-10-12", hvLevelConfirmed: true }
    return { ...technician, hvLevel: 0, hvLevelValidUntil: null, hvLevelConfirmed: false, brandSpecialisms: [] }
  }),
}

describe("HV competence on the Technicians page", () => {
  it("shows each level with its IMI name, its validity in the dealership's calendar and the brands, not used for allocation yet", async () => {
    mockBoardApi({ features: () => vehicleAwareOn, schedule: () => readingTuesdayWithCompetence })
    renderBoard(page)

    const list = await table()
    expect(await within(list).findByRole("columnheader", { name: /HV competence/ })).toBeInTheDocument()
    expect(columnTexts(list, "HV competence")).toEqual([
      "HV 2Routine maintenance, level 2 of 4Valid until 31 Dec 2028",
      "HV 3Component repair, level 3 of 4Valid until 31 Dec 2028",
      "HV 2Routine maintenance, level 2 of 4Valid until 31 Dec 2028",
      "HV 2Routine maintenance, level 2 of 4Valid until 31 Dec 2028",
      "HV 3Component repair, level 3 of 4Valid until 31 Dec 2028",
      "HV 1Awareness, level 1 of 4Valid until 31 Dec 2028",
    ])
    // At 1440 px the brands and the employee number are left out by default (View brings them back), so the table fits.
    expect(headers(list)).toEqual(["Technician", "Certified for", "HV competence", "Status", "Appointments today", "Booked today"])
    expect(screen.queryByRole("region", { name: "HV levels to review" })).not.toBeInTheDocument()
  })

  it("names unconfirmed and expired levels, and says why and what to do, on a migrated database", async () => {
    viewportOf(1700)
    mockBoardApi({ features: () => vehicleAwareOn, schedule: () => migrated })
    renderBoard(page)

    const list = await table()
    const [amelia, ben, , , , farid] = columnTexts(list, "HV competence")
    expect(amelia).toBe("No HV, level 0 of 4: No HV trainingUnconfirmed, needs review")
    expect(ben).toBe("HV 3Component repair, level 3 of 4Unconfirmed, needs review")
    expect(farid).toBe("HV 1Awareness, level 1 of 4, expiredExpired 12 Oct 2026: counts as no HV training")
    expect(headers(list)).toContain("Brandsnot used for allocation yet")

    const note = screen.getByRole("region", { name: "HV levels to review" })
    expect(note).toHaveTextContent("5 HV levels need review")
    expect(note).toHaveTextContent("Amelia Clarke, Ben Okafor, Chloe Nguyen, Daniel Moss and Eva Lindqvist: carried over from the old high-voltage certificate")
    expect(note).toHaveTextContent("a technician at level 0 can’t take work on a vehicle that may be high-voltage")
    expect(note).toHaveTextContent("Reseed demo data (Admin) restores the seeded, confirmed levels")
  })

  it("filters by level, by what needs review and by what expired", async () => {
    mockBoardApi({ features: () => vehicleAwareOn, schedule: () => migrated })
    renderBoard(page)
    const list = await table()

    const filter = await openFilter("HV competence")
    fireEvent.click(within(filter).getByRole("checkbox", { name: /^Expired/ }))

    expect(columnTexts(list, "Technician")).toEqual(["FHFarid Haddad"])
  })

  it("shows the competence on a phone's card", async () => {
    viewportOf(390)
    mockBoardApi({ features: () => vehicleAwareOn, schedule: () => readingTuesdayWithCompetence })
    renderBoard(page)

    const cards = await screen.findByRole("list", { name: "Technicians" })
    const ben = within(cards).getByRole("heading", { name: "Ben Okafor" }).closest("li")!
    expect(ben).toHaveTextContent("HV 3Component repair")
    expect(ben).toHaveTextContent("Valid until 31 Dec 2028")
    expect(ben).toHaveTextContent("VOLKSWAGEN specialist, not used for allocation yet")
  })

  it("shows nothing of it with vehicle-aware requirements off", async () => {
    mockBoardApi({ features: () => vehicleAwareOff, schedule: () => readingTuesday })
    renderBoard(page)

    const list = await table()
    expect(headers(list)).toEqual(["Technician", "Employee no.", "Certified for", "Status", "Appointments today", "Booked today"])
  })
})
