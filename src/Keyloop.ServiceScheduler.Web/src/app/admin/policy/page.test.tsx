import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { CurrentUserResponse, PolicyBookabilityChange, PolicyWriteRequest, RequirementRuleInput } from "@/api/types.gen"
import { currentUserQueryKey } from "@/lib/session"
import { adminServer, type AdminServerOptions, defaultRules, policyETagOf } from "@/test/admin-api"
import { mockBoardApi, requestsTo } from "@/test/board-api"
import { readingCatalogue } from "@/test/catalogue"
import { reading } from "@/test/dealerships"
import { admin, serviceAdvisor, viewer } from "@/test/identities"
import { renderBoard, viewportOf } from "@/test/render-board"
import { vehicleAwareOn } from "@/test/vehicle"

// Task 30b: the requirement policy editor. The rules are a table of typed rules in words (ADR-029's vocabulary, no
// expressions); an Admin edits a draft, previews what it would change with today's roster (the API's dry-run), and only
// then publishes it as version n+1, with the version it was made from as If-Match. The version history comes from the
// change history. A Service advisor or a Viewer is told the policy is the Admin's, and nothing is read for them.

beforeAll(async () => {
  await Promise.all([import("@/app/admin/layout"), import("@/app/admin/policy/page")])
})

beforeEach(() => {
  // Tuesday 2026-10-13, 09:30 in Reading.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

const page = `/resources/policy?dealership=${reading.id}`
const interim = readingCatalogue.find((service) => service.code === "INTERIM-SERVICE")!

/** What raising the routine rule to level 4 makes unbookable at Reading, where nobody holds level 4. */
function routineAtFour(rules: readonly RequirementRuleInput[]): PolicyBookabilityChange[] {
  if (rules.find((rule) => rule.code === "hv-routine")?.minimumHvLevel !== 4) return []
  return (["BatteryElectric", "Unknown"] as const).flatMap((powertrain) =>
    (["Car", "LightCommercial", "Heavy", "Unknown"] as const).map((vehicleClass) => ({
      serviceTypeId: interim.id,
      serviceCode: interim.code,
      powertrain,
      vehicleClass,
      needsLiveDiagnosis: false,
      wasBookable: true,
      isBookable: false,
    }))
  )
}

interface Setup extends Omit<AdminServerOptions, "me"> {
  me?: CurrentUserResponse
}

function setup({ me = admin, ...options }: Setup = {}) {
  const session = { me }
  const server = adminServer({ me: () => session.me, changes: routineAtFour, ...options })
  const api = mockBoardApi({ me: () => session.me, features: () => vehicleAwareOn, serviceTypes: () => readingCatalogue, admin: server })
  return { session, server, api, ...renderBoard(page) }
}

const rulesTable = () => screen.findByRole("table", { name: "Rules" }, { timeout: 5000 })
const ruleRow = (table: HTMLElement, code: string) => within(table).getAllByRole("row").find((row) => row.textContent?.includes(code))!
const policyWrites = (requests: readonly Request[]) => requestsTo(requests, "/requirement-policy").filter((request) => request.method === "PUT")
const bodyOf = async (request: Request) => (await request.clone().json()) as PolicyWriteRequest

/** Opens a rule's editor from its row, sets its minimum HV level and saves it into the draft. */
async function setLevel(code: string, level: string) {
  fireEvent.click(within(ruleRow(await rulesTable(), code)).getByRole("button", { name: `Edit ${code}` }))
  const dialog = await screen.findByRole("dialog", { name: `Edit rule ${code}` })
  fireEvent.click(within(dialog).getByRole("radio", { name: level }))
  fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }))
  await waitFor(() => expect(screen.queryByRole("dialog", { name: `Edit rule ${code}` })).not.toBeInTheDocument())
}

const publish = () => screen.getByRole("button", { name: /^Publish version/ })

describe("the requirement policy, as an Admin", () => {
  it("lists the version's typed rules in words", async () => {
    setup()

    const table = await rulesTable()
    expect(screen.getByRole("heading", { level: 2, name: "Version 2" })).toBeInTheDocument()
    const routine = ruleRow(table, "hv-routine")
    expect(routine).toHaveTextContent(
      "Interim Service, Full Service, Brake Pads & Discs, Diagnostic Fault Finding and Heavy Van Service, on a vehicle that may be high-voltage"
    )
    expect(routine).toHaveTextContent("HV 2")
    expect(ruleRow(table, "heavy-vehicle")).toHaveTextContent("A heavy vehicle")
    expect(ruleRow(table, "heavy-vehicle")).toHaveTextContent("Heavy-duty lift")
    expect(ruleRow(table, "hv-live-diagnosis")).toHaveTextContent("Live HV diagnosis")
    expect(ruleRow(table, "hv-live-diagnosis")).toHaveTextContent("HV 4")
    // Nothing to publish yet.
    expect(screen.queryByRole("button", { name: /^Publish version/ })).not.toBeInTheDocument()
  })

  it("previews a stricter rule with today's roster before it can be published, then publishes version 3", async () => {
    const { api } = setup()

    await setLevel("hv-routine", "Level 4, Live working")
    expect(ruleRow(await rulesTable(), "hv-routine")).toHaveTextContent("Changed")
    // Publishing waits for a preview of this very draft.
    expect(publish()).toHaveAttribute("aria-disabled", "true")
    expect(document.getElementById(publish().getAttribute("aria-describedby")!)).toHaveTextContent("Preview the changes before publishing them.")

    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }))
    const preview = await screen.findByRole("region", { name: "What version 3 would change" })
    expect(preview).toHaveTextContent("With today's roster, on Tuesday 13 October 2026")
    expect(within(preview).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Interim Service can no longer be booked for a battery-electric or unknown powertrain, any vehicle class (without live HV diagnosis)",
    ])
    const [dryRun] = policyWrites(api.requests)
    expect(dryRun.headers.get("If-Match")).toBe(policyETagOf(2))
    const sentPreview = await bodyOf(dryRun)
    expect(sentPreview).toMatchObject({ dryRun: true, previewDate: "2026-10-13" })
    expect(sentPreview.rules.find((rule) => rule.code === "hv-routine")?.minimumHvLevel).toBe(4)
    expect(sentPreview.rules).toHaveLength(defaultRules.length)

    expect(publish()).not.toHaveAttribute("aria-disabled", "true")
    fireEvent.click(publish())
    expect(await screen.findByText("Policy version 3 published")).toBeInTheDocument()
    const [, published] = policyWrites(api.requests)
    expect(published.headers.get("If-Match")).toBe(policyETagOf(2))
    expect(await bodyOf(published)).toEqual({ ...sentPreview, dryRun: false })
    expect(await screen.findByRole("heading", { level: 2, name: "Version 3" })).toBeInTheDocument()
  })

  it("asks for a new preview once the draft changes after one", async () => {
    setup()

    await setLevel("hv-routine", "Level 4, Live working")
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }))
    await screen.findByRole("region", { name: "What version 3 would change" })
    expect(publish()).not.toHaveAttribute("aria-disabled", "true")

    await setLevel("hv-aircon", "Level 4, Live working")
    expect(publish()).toHaveAttribute("aria-disabled", "true")
    expect(screen.queryByRole("region", { name: "What version 3 would change" })).not.toBeInTheDocument()
  })

  it("says so when the change makes no service bookable or unbookable", async () => {
    setup()

    await setLevel("hv-aircon", "Level 4, Live working")
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }))
    const preview = await screen.findByRole("region", { name: "What version 3 would change" })
    expect(preview).toHaveTextContent("No service becomes bookable or unbookable with today's roster.")
  })

  it("adds a typed rule, checking its code, and removes one with a way back", async () => {
    setup()

    await rulesTable()
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }))
    const dialog = await screen.findByRole("dialog", { name: "Add rule" })
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Code" }), { target: { value: "Van HV" } })
    fireEvent.click(within(dialog).getByRole("radio", { name: "A vehicle class" }))
    fireEvent.click(within(dialog).getByRole("radio", { name: "Light commercial (van)" }))
    fireEvent.click(within(dialog).getByRole("radio", { name: "Level 1, Awareness" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }))
    expect(within(dialog).getByText("Use lower-case letters, digits and hyphens, starting with a letter, up to 64 characters.")).toBeInTheDocument()

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Code" }), { target: { value: "hv-routine" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }))
    expect(within(dialog).getByText("Another rule already has this code.")).toBeInTheDocument()

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Code" }), { target: { value: "van-hv" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }))
    const row = ruleRow(await rulesTable(), "van-hv")
    expect(row).toHaveTextContent("A light commercial (van)")
    expect(row).toHaveTextContent("New")

    fireEvent.click(within(ruleRow(await rulesTable(), "hv-aircon")).getByRole("button", { name: "Remove hv-aircon" }))
    const removed = screen.getByRole("list", { name: "Removed rules" })
    expect(removed).toHaveTextContent("hv-aircon")
    fireEvent.click(within(removed).getByRole("button", { name: "Put hv-aircon back" }))
    expect(ruleRow(await rulesTable(), "hv-aircon")).toBeDefined()
    expect(screen.getByText("1 change to version 2")).toBeInTheDocument()
  })

  it("checks a service rule names services and powertrains", async () => {
    setup()

    await rulesTable()
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }))
    const dialog = await screen.findByRole("dialog", { name: "Add rule" })
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Code" }), { target: { value: "ev-mot" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }))

    expect(within(dialog).getByText("Choose at least one service.")).toBeInTheDocument()
    expect(within(dialog).getByText("Choose at least one powertrain.")).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "MOT Test" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Every powertrain that may be high-voltage" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }))
    expect(ruleRow(await rulesTable(), "ev-mot")).toHaveTextContent("MOT Test, on a vehicle that may be high-voltage")
  })

  it("keeps the draft on the version another Admin published meanwhile, and asks for a new preview", async () => {
    const { server, api } = setup()

    await setLevel("hv-routine", "Level 4, Live working")
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }))
    await screen.findByRole("region", { name: "What version 3 would change" })
    server.editedElsewhere.policy(defaultRules.map((rule) => (rule.code === "hv-aircon" ? { ...rule, minimumHvLevel: 4 } : rule)))
    fireEvent.click(publish())

    const conflict = await screen.findByRole("region", { name: "Version 3 was published while you were editing" })
    expect(within(conflict).getByRole("row", { name: /hv-aircon/ })).toHaveTextContent("HV 3")
    expect(within(conflict).getByRole("row", { name: /hv-aircon/ })).toHaveTextContent("HV 4")
    fireEvent.click(within(conflict).getByRole("button", { name: "Keep my changes on version 3" }))

    const table = await rulesTable()
    expect(screen.getByRole("heading", { level: 2, name: "Version 3" })).toBeInTheDocument()
    expect(ruleRow(table, "hv-routine")).toHaveTextContent("HV 4")
    expect(ruleRow(table, "hv-aircon")).toHaveTextContent("HV 4")
    expect(publish()).toHaveAttribute("aria-disabled", "true")

    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }))
    await screen.findByRole("region", { name: "What version 4 would change" })
    fireEvent.click(publish())
    expect(await screen.findByText("Policy version 4 published")).toBeInTheDocument()
    expect(policyWrites(api.requests).map((request) => request.headers.get("If-Match"))).toEqual([
      policyETagOf(2),
      policyETagOf(2),
      policyETagOf(3),
      policyETagOf(3),
    ])
  })

  it("discards the draft when asked", async () => {
    setup()

    await setLevel("hv-routine", "Level 4, Live working")
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }))

    expect(ruleRow(await rulesTable(), "hv-routine")).toHaveTextContent("HV 2")
    expect(screen.queryByRole("button", { name: /^Publish version/ })).not.toBeInTheDocument()
  })

  it("shows the version history, what each publication changed and who published it", async () => {
    setup()

    await setLevel("hv-routine", "Level 4, Live working")
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }))
    await screen.findByRole("region", { name: "What version 3 would change" })
    fireEvent.click(publish())
    await screen.findByText("Policy version 3 published")

    const history = await screen.findByRole("region", { name: "Versions" })
    const latest = await within(history).findByRole("article", { name: /^Version 3/ })
    expect(latest).toHaveTextContent("admin@keyloop.test")
    expect(latest).toHaveTextContent("hv-routine")
    expect(latest).toHaveTextContent("HV 2 to HV 4")
    expect(within(history).getByRole("article", { name: /^Version 2/ })).toBeInTheDocument()
  })

  it("discards the draft without publishing when another Admin signs in", async () => {
    const { session, queryClient, api } = setup()

    await setLevel("hv-routine", "Level 4, Live working")
    const other = { ...admin, email: "another.admin@keyloop.test" }
    session.me = other
    act(() => queryClient.setQueryData(currentUserQueryKey(), other))

    expect(await screen.findByText("Your unpublished changes were discarded: who is signed in changed.")).toBeInTheDocument()
    expect(ruleRow(await rulesTable(), "hv-routine")).toHaveTextContent("HV 2")
    expect(policyWrites(api.requests)).toHaveLength(0)
  })

  // Everything the editor holds is the Admin's it was made for (Codex check of Task 30b): a 412's comparison (whose Keep
  // would carry the rules into the next Admin's draft), an open rule and the last write's failure go with the draft.
  const signInAs = async (session: { me: CurrentUserResponse }, queryClient: { setQueryData: (key: readonly unknown[], data: unknown) => unknown }) => {
    const other = { ...admin, email: "another.admin@keyloop.test" }
    session.me = other
    act(() => void queryClient.setQueryData(currentUserQueryKey(), other))
  }

  it("drops a conflict's comparison when another Admin signs in, so its rules never carry over", async () => {
    const { server, api, session, queryClient } = setup()

    await setLevel("hv-routine", "Level 4, Live working")
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }))
    await screen.findByRole("region", { name: "What version 3 would change" })
    server.editedElsewhere.policy(defaultRules.map((rule) => (rule.code === "hv-aircon" ? { ...rule, minimumHvLevel: 4 } : rule)))
    fireEvent.click(publish())
    await screen.findByRole("region", { name: "Version 3 was published while you were editing" })

    await signInAs(session, queryClient)

    expect(await screen.findByText("Your unpublished changes were discarded: who is signed in changed.")).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: /was published while you were editing/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Keep my changes/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("region", { name: /would change$/ })).not.toBeInTheDocument()
    await waitFor(async () => expect(ruleRow(await rulesTable(), "hv-routine")).toHaveTextContent("HV 2"))
    expect(screen.queryByRole("button", { name: /^Publish version/ })).not.toBeInTheDocument()
    expect(policyWrites(api.requests)).toHaveLength(2)
  })

  it("closes an open rule without saving it when another Admin signs in", async () => {
    const { api, session, queryClient } = setup()

    fireEvent.click(within(ruleRow(await rulesTable(), "hv-routine")).getByRole("button", { name: "Edit hv-routine" }))
    const dialog = await screen.findByRole("dialog", { name: "Edit rule hv-routine" })
    fireEvent.click(within(dialog).getByRole("radio", { name: "Level 4, Live working" }))

    await signInAs(session, queryClient)

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit rule hv-routine" })).not.toBeInTheDocument())
    expect(await screen.findByText("Your unpublished changes were discarded: who is signed in changed.")).toBeInTheDocument()
    expect(ruleRow(await rulesTable(), "hv-routine")).toHaveTextContent("HV 2")
    expect(policyWrites(api.requests)).toHaveLength(0)
  })

  it("does not show the previous Admin's failed preview to the next", async () => {
    const { session, queryClient } = setup({
      refuse: (request) =>
        request.method === "PUT" ? new Response(JSON.stringify({ title: "Service unavailable", status: 503 }), { status: 503, headers: { "Content-Type": "application/problem+json" } }) : undefined,
    })

    await setLevel("hv-routine", "Level 4, Live working")
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }))
    expect(await screen.findByText("Couldn’t preview the changes")).toBeInTheDocument()

    await signInAs(session, queryClient)

    expect(await screen.findByText("Your unpublished changes were discarded: who is signed in changed.")).toBeInTheDocument()
    expect(screen.queryByText("Couldn’t preview the changes")).not.toBeInTheDocument()
  })

  it("fits a phone: the rules as cards", async () => {
    viewportOf(390)
    setup()

    const cards = await screen.findByRole("list", { name: "Rules" }, { timeout: 5000 })
    expect(within(cards).getAllByRole("listitem")).toHaveLength(defaultRules.length)
  })
})

describe("the requirement policy in the sidebar", () => {
  it.each([
    ["an Admin", admin, true],
    ["a Service advisor", serviceAdvisor, false],
    ["a Viewer", viewer, false],
  ])("is offered to %s only if an Admin (%#)", async (_, me, offered) => {
    setup({ me })

    // Once /me has answered: the page shows the Admin's rules, or the reason.
    if (offered) await rulesTable()
    else await screen.findByText(/The requirement policy is kept by a workshop Admin/, undefined, { timeout: 5000 })
    const resources = screen.getByRole("navigation", { name: "Resources" })
    expect(within(resources).queryByRole("link", { name: "Requirement policy" }) !== null).toBe(offered)
  })
})

describe("the requirement policy for other roles", () => {
  it.each([
    ["a Service advisor", serviceAdvisor],
    ["a Viewer", viewer],
  ])("tells %s it is the Admin's, and reads nothing", async (_, me) => {
    const { api } = setup({ me })

    expect(await screen.findByText(/The requirement policy is kept by a workshop Admin/, undefined, { timeout: 5000 })).toBeInTheDocument()
    expect(requestsTo(api.requests, "/requirement-policy")).toHaveLength(0)
    expect(requestsTo(api.requests, "/admin-history")).toHaveLength(0)
  })
})
