import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { AdminHistoryItem, CurrentUserResponse } from "@/api/types.gen"
import { adminServer, adminTechnicians, defaultRules } from "@/test/admin-api"
import { mockBoardApi, requestsTo } from "@/test/board-api"
import { readingCatalogue } from "@/test/catalogue"
import { reading } from "@/test/dealerships"
import { admin, serviceAdvisor, viewer } from "@/test/identities"
import { renderBoard } from "@/test/render-board"
import { bays, technicians } from "@/test/schedules"
import { vehicleAwareOn } from "@/test/vehicle"

// Task 30b: the change history (Task 30a's audit), for an Admin: who changed a technician, a bay or the requirement policy,
// when, and what changed, field by field, newest first; filtered by kind or one resource, with older changes on request.

beforeAll(async () => {
  await Promise.all([import("@/app/admin/layout"), import("@/app/admin/history/page"), import("@/app/admin/technicians/page")])
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

const ben = adminTechnicians()[1]
const benWrite = {
  name: ben.name,
  employeeNumber: ben.employeeNumber,
  certifications: ben.certifications,
  isActive: ben.isActive,
  hvLevel: ben.hvLevel,
  hvLevelValidUntil: ben.hvLevelValidUntil,
  hvLevelConfirmed: ben.hvLevelConfirmed,
  brandSpecialisms: ben.brandSpecialisms,
}

/** Four changes, newest first, as the API answers them. */
const history: AdminHistoryItem[] = [
  {
    id: "h4",
    resourceKind: "technician",
    resourceId: technicians.ben.id,
    action: "edit",
    actor: "user:another.admin@keyloop.test",
    atUtc: "2026-10-13T08:10:00Z",
    before: benWrite,
    after: { ...benWrite, hvLevel: 2, hvLevelValidUntil: "2027-06-30" },
  },
  {
    id: "h3",
    resourceKind: "bay",
    resourceId: bays.ev.id,
    action: "deactivate",
    actor: "user:admin@keyloop.test",
    atUtc: "2026-10-13T07:55:00Z",
    before: { name: "Bay 4 - EV", capabilities: ["StandardLift", "EvHighVoltage"], isActive: true },
    after: { name: "Bay 4 - EV", capabilities: ["StandardLift", "EvHighVoltage"], isActive: false },
  },
  {
    id: "h2",
    resourceKind: "policy",
    resourceId: reading.id,
    action: "publish",
    actor: "user:admin@keyloop.test",
    atUtc: "2026-10-12T15:00:00Z",
    before: { dealershipId: reading.id, version: 2, rules: defaultRules },
    after: { dealershipId: reading.id, version: 3, rules: defaultRules.map((rule) => (rule.code === "hv-aircon" ? { ...rule, minimumHvLevel: 4 } : rule)) },
  },
  {
    id: "h1",
    resourceKind: "technician",
    resourceId: technicians.ben.id,
    action: "confirm-hv",
    actor: "user:admin@keyloop.test",
    atUtc: "2026-10-12T09:00:00Z",
    before: { ...benWrite, hvLevelConfirmed: false },
    after: benWrite,
  },
]

function setup(me: CurrentUserResponse = admin, items = history, path = `/resources/history?dealership=${reading.id}`) {
  const server = adminServer({ me: () => me, history: items })
  const api = mockBoardApi({ me: () => me, features: () => vehicleAwareOn, serviceTypes: () => readingCatalogue, admin: server })
  return { api, ...renderBoard(path) }
}

const changes = () => screen.findByRole("feed", { name: "Changes" }, { timeout: 5000 })
const historyReads = (requests: readonly Request[]) => requestsTo(requests, "/admin-history").map((request) => Object.fromEntries(new URL(request.url).searchParams))

describe("the change history, as an Admin", () => {
  it("lists every change newest first: what changed, field by field, when and by whom", async () => {
    setup()

    const feed = await changes()
    const entries = within(feed).getAllByRole("article")
    expect(entries.map((entry) => entry.getAttribute("aria-labelledby") && document.getElementById(entry.getAttribute("aria-labelledby")!)?.textContent)).toEqual([
      "Ben Okafor edited",
      "Bay 4 - EV taken out of service",
      "Requirement policy version 3 published",
      "Ben Okafor's HV level confirmed",
    ])
    expect(entries[0]).toHaveTextContent("another.admin@keyloop.test")
    expect(entries[0]).toHaveTextContent("Tue 13 Oct, 09:10")
    expect(within(entries[0]).getByRole("row", { name: "HV level HV 3 HV 2" })).toBeInTheDocument()
    expect(within(entries[0]).getByRole("row", { name: "Valid until 31 Dec 2028 30 Jun 2027" })).toBeInTheDocument()
    expect(within(entries[1]).getByRole("row", { name: "Service In service Out of service" })).toBeInTheDocument()
    expect(entries[2]).toHaveTextContent("hv-aircon: HV 3 to HV 4")
    expect(within(entries[3]).getByRole("row", { name: "Level confirmed Unconfirmed Confirmed" })).toBeInTheDocument()
  })

  it("filters by kind, asking the API for that kind only", async () => {
    const { api } = setup()

    await changes()
    fireEvent.click(screen.getByRole("radio", { name: "Bays" }))

    await waitFor(async () => expect(within(await changes()).getAllByRole("article")).toHaveLength(1))
    expect(historyReads(api.requests).at(-1)).toMatchObject({ resourceKind: "bay", offset: "0" })
  })

  it("shows one technician's changes when opened from their row, with a way back to every change", async () => {
    const { api, router } = setup(admin, history, `/resources/technicians?dealership=${reading.id}`)

    fireEvent.click(await screen.findByRole("button", { name: "Actions for Ben Okafor" }, { timeout: 5000 }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Change history" }))

    await waitFor(() => expect(router.state.location.pathname).toBe("/resources/history"))
    expect(await screen.findByRole("heading", { name: "Ben Okafor's changes" }, { timeout: 5000 })).toBeInTheDocument()
    expect(within(await changes()).getAllByRole("article")).toHaveLength(2)
    expect(historyReads(api.requests).at(-1)).toMatchObject({ resourceKind: "technician", resourceId: technicians.ben.id })
    fireEvent.click(screen.getByRole("link", { name: "Show every change" }))
    await waitFor(async () => expect(within(await changes()).getAllByRole("article")).toHaveLength(4))
  })

  it("loads older changes on request", async () => {
    const many: AdminHistoryItem[] = Array.from({ length: 30 }, (_, index) => ({
      ...history[1],
      id: `bay-${index}`,
      atUtc: new Date(Date.parse("2026-10-13T07:55:00Z") - index * 60_000).toISOString(),
    }))
    const { api } = setup(admin, many)

    expect(within(await changes()).getAllByRole("article")).toHaveLength(25)
    fireEvent.click(screen.getByRole("button", { name: "Show older changes" }))

    await waitFor(async () => expect(within(await changes()).getAllByRole("article")).toHaveLength(30))
    expect(historyReads(api.requests).at(-1)).toMatchObject({ offset: "25", limit: "25" })
    expect(screen.queryByRole("button", { name: "Show older changes" })).not.toBeInTheDocument()
    // The last page took the button away: focus is on the first change it loaded.
    await waitFor(async () => expect(within(await changes()).getAllByRole("article")[25]).toHaveFocus())
  })

  it("says when nothing has been changed yet", async () => {
    setup(admin, [])

    expect(await screen.findByRole("heading", { name: "No changes yet" }, { timeout: 5000 })).toBeInTheDocument()
  })
})

describe("the change history for other roles", () => {
  it.each([
    ["a Service advisor", serviceAdvisor],
    ["a Viewer", viewer],
  ])("tells %s it is the Admin's, and reads nothing", async (_, me) => {
    const { api } = setup(me)

    expect(await screen.findByText(/The change history is kept for workshop Admins/, undefined, { timeout: 5000 })).toBeInTheDocument()
    expect(requestsTo(api.requests, "/admin-history")).toHaveLength(0)
  })
})
