import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { AppointmentListItemResponse, CurrentUserResponse } from "@/api/types.gen"
import { currentUserQueryKey } from "@/lib/session"
import { adminServer, type AdminServerOptions, etagOf } from "@/test/admin-api"
import { mockBoardApi, requestsTo } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { admin, serviceAdvisor, viewer } from "@/test/identities"
import { renderBoard, viewportOf } from "@/test/render-board"
import { bodyRows } from "@/test/resource-list"
import { appointments, bays, technicians } from "@/test/schedules"

// Task 30b: an Admin adds bays, edits their name and equipment, and takes one out of service (after seeing which upcoming
// appointments would then be flagged) or back. Every write carries the version it was made from. A Service advisor and a
// Viewer see the bays read-only, with the reason.

beforeAll(async () => {
  await Promise.all([import("@/app/admin/layout"), import("@/app/admin/bays/page")])
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

const page = `/resources/bays?dealership=${reading.id}`
const otherAdmin: CurrentUserResponse = { ...admin, email: "another.admin@keyloop.test", displayName: "Another Admin" }
/** Bay 4 - EV is the fourth bay: its version is the fixtures' fourth. */
const EV_VERSION = 560

interface Setup extends Omit<AdminServerOptions, "me"> {
  me?: CurrentUserResponse
  range?: AppointmentListItemResponse[]
}

function setup({ me = admin, range, ...options }: Setup = {}) {
  const session = { me }
  const server = adminServer({ me: () => session.me, ...options })
  const api = mockBoardApi({ me: () => session.me, range: range ? () => range : undefined, admin: server })
  return { session, server, api, ...renderBoard(page) }
}

const table = () => screen.findByRole("table", { name: "Bays" })
const writes = (requests: readonly Request[], method: string) =>
  requests.filter((request) => request.method === method && new URL(request.url).pathname.includes("/bays"))
const bodyOf = async (request: Request) => request.clone().json()
const rowOf = (list: HTMLElement, name: string) => bodyRows(list).find((row) => row.textContent?.includes(name))

async function rowAction(name: string, action: string) {
  fireEvent.click(await screen.findByRole("button", { name: `Actions for ${name}` }))
  fireEvent.click(await screen.findByRole("menuitem", { name: action }))
}

async function editForm(name: string) {
  await table()
  await rowAction(name, "Edit")
  const sheet = await screen.findByRole("dialog", { name: `Edit ${name}` })
  await waitFor(() => expect(within(sheet).getByRole("textbox", { name: "Name" })).toHaveValue(name))
  return sheet
}

const save = (sheet: HTMLElement) => fireEvent.click(within(sheet).getByRole("button", { name: "Save changes" }))

describe("editing bays, as an Admin", () => {
  it("offers Add bay and each row's actions", async () => {
    setup()

    await table()
    expect(screen.getByRole("button", { name: "Add bay" })).not.toHaveAttribute("aria-disabled", "true")
    fireEvent.click(screen.getByRole("button", { name: "Actions for Bay 4 - EV" }))
    expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual(["Edit", "Take out of service", "Change history"])
  })

  it("edits a bay's name and equipment and saves the whole state with the version it was read at", async () => {
    const { api } = setup()

    const sheet = await editForm("Bay 4 - EV")
    expect(within(sheet).getByRole("checkbox", { name: "EV high voltage" })).toBeChecked()
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Name" }), { target: { value: "Bay 4 - EV and diagnostics" } })
    fireEvent.click(within(sheet).getByRole("checkbox", { name: "Diagnostics" }))
    save(sheet)

    expect(await screen.findByText("Bay saved")).toBeInTheDocument()
    const [put] = writes(api.requests, "PUT")
    expect(put.headers.get("If-Match")).toBe(etagOf(EV_VERSION))
    expect(await bodyOf(put)).toEqual({ name: "Bay 4 - EV and diagnostics", capabilities: ["StandardLift", "EvHighVoltage", "Diagnostics"], isActive: true })
    await waitFor(async () => expect(rowOf(await table(), "Bay 4 - EV and diagnostics")).toBeDefined())
  })

  it("checks the name before sending", async () => {
    const { api } = setup()

    const sheet = await editForm("Bay 4 - EV")
    const name = within(sheet).getByRole("textbox", { name: "Name" })
    fireEvent.change(name, { target: { value: "" } })
    save(sheet)

    const error = await within(sheet).findByText("Enter the bay's name.")
    expect(name).toHaveAttribute("aria-invalid", "true")
    expect(name.getAttribute("aria-describedby")).toContain(error.id)
    expect(writes(api.requests, "PUT")).toHaveLength(0)
  })

  it("adds a bay, sent without a version", async () => {
    const { api } = setup()

    await table()
    fireEvent.click(screen.getByRole("button", { name: "Add bay" }))
    const sheet = await screen.findByRole("dialog", { name: "Add bay" })
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Name" }), { target: { value: "Bay 7 - Tyres" } })
    fireEvent.click(within(sheet).getByRole("checkbox", { name: "Standard lift" }))
    fireEvent.click(within(sheet).getByRole("button", { name: "Add bay" }))

    expect(await screen.findByText("Bay added")).toBeInTheDocument()
    const [post] = writes(api.requests, "POST")
    expect(post.headers.has("If-Match")).toBe(false)
    expect(await bodyOf(post)).toEqual({ name: "Bay 7 - Tyres", capabilities: ["StandardLift"], isActive: true })
  })

  it("says what changed when another Admin saved first, and reapplies this Admin's changes over it", async () => {
    const { server, api } = setup()

    const sheet = await editForm("Bay 4 - EV")
    const now = server.editedElsewhere.bay(bays.ev.id, { capabilities: ["StandardLift"] })
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Name" }), { target: { value: "Bay 4 - Electric" } })
    save(sheet)

    const conflict = await within(sheet).findByRole("region", { name: "Someone else changed Bay 4 - EV" })
    expect(within(conflict).getByRole("row", { name: /Equipment Standard lift, EV high voltage Standard lift No change/ })).toBeInTheDocument()
    fireEvent.click(within(conflict).getByRole("button", { name: "Reapply my changes" }))
    await waitFor(() => expect(within(sheet).getByRole("textbox", { name: "Name" })).toHaveValue("Bay 4 - Electric"))
    expect(within(sheet).getByRole("checkbox", { name: "EV high voltage" })).not.toBeChecked()
    save(sheet)

    expect(await screen.findByText("Bay saved")).toBeInTheDocument()
    const reapplied = writes(api.requests, "PUT")[1]
    expect(reapplied.headers.get("If-Match")).toBe(etagOf(now.version))
    expect(await bodyOf(reapplied)).toEqual({ name: "Bay 4 - Electric", capabilities: ["StandardLift"], isActive: true })
  })

  it("previews the upcoming appointments that would be flagged before taking a bay out of service", async () => {
    const at = (id: string, date: string, bay: { id: string; name: string }) => ({
      ...appointments.evBattery,
      id,
      bay,
      technician: technicians.ben,
      startUtc: `${date}T08:00:00Z`,
      endUtc: `${date}T09:00:00Z`,
      startLocal: `${date}T09:00+01:00`,
      endLocal: `${date}T10:00+01:00`,
    })
    const { api } = setup({ range: [at("e1", "2026-10-14", bays.ev), at("e2", "2026-10-14", bays.standard)] })

    await table()
    await rowAction("Bay 4 - EV", "Take out of service")
    const dialog = await screen.findByRole("dialog", { name: "Take Bay 4 - EV out of service?" })
    expect(await within(dialog).findByText("1 upcoming appointment would be flagged for review")).toBeInTheDocument()
    expect(within(dialog).getByText("EV Battery Health Check, Ben Okafor")).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Take out of service" }))

    expect(await screen.findByText("Bay taken out of service")).toBeInTheDocument()
    const [put] = writes(api.requests, "PUT")
    expect(put.headers.get("If-Match")).toBe(etagOf(EV_VERSION))
    expect(await bodyOf(put)).toEqual({ name: "Bay 4 - EV", capabilities: ["StandardLift", "EvHighVoltage"], isActive: false })
    await waitFor(async () => expect(rowOf(await table(), "Bay 4 - EV")).toHaveTextContent("Out of service"))
  })

  it("returns a bay to service", async () => {
    const { api } = setup({ bays: (records) => records.map((record) => (record.id === bays.ev.id ? { ...record, isActive: false } : record)) })

    await table()
    await rowAction("Bay 4 - EV", "Return to service")
    const dialog = await screen.findByRole("dialog", { name: "Return Bay 4 - EV to service?" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Return to service" }))

    expect(await screen.findByText("Bay back in service")).toBeInTheDocument()
    expect(await bodyOf(writes(api.requests, "PUT")[0])).toMatchObject({ isActive: true })
  })

  it("closes an open form without saving when another Admin signs in", async () => {
    const { session, api, queryClient } = setup()

    const sheet = await editForm("Bay 4 - EV")
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Name" }), { target: { value: "Bay 4 - Renamed" } })
    session.me = otherAdmin
    act(() => queryClient.setQueryData(currentUserQueryKey(), otherAdmin))

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Bay 4 - EV" })).not.toBeInTheDocument())
    expect(await screen.findByText("The bay you were editing was closed without saving: who is signed in changed.")).toBeInTheDocument()
    expect(writes(api.requests, "PUT")).toHaveLength(0)
  })

  it("opens the form full height on a phone", async () => {
    viewportOf(390)
    setup()

    const cards = await screen.findByRole("list", { name: "Bays" })
    fireEvent.click(within(cards).getByRole("button", { name: "Actions for Bay 4 - EV" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }))
    expect(await screen.findByRole("dialog", { name: "Edit Bay 4 - EV" })).toHaveAttribute("data-side", "bottom")
  })
})

describe("the bays list for other roles", () => {
  it.each([
    ["a Service advisor", serviceAdvisor],
    ["a Viewer", viewer],
  ])("is read-only for %s, with the reason, and reads nothing an Admin reads", async (_, me) => {
    const { api } = setup({ me })

    await table()
    const add = screen.getByRole("button", { name: "Add bay" })
    expect(add).toHaveAttribute("aria-disabled", "true")
    expect(document.getElementById(add.getAttribute("aria-describedby")!)).toHaveTextContent(
      "Your role can view bays but not change them. Changes are made by a workshop Admin."
    )
    expect(screen.queryByRole("button", { name: /^Actions for/ })).not.toBeInTheDocument()
    expect(requestsTo(api.requests, "/bays")).toHaveLength(0)
  })
})
