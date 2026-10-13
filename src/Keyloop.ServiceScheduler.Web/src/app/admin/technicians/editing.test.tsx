import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { AppointmentListItemResponse, CurrentUserResponse } from "@/api/types.gen"
import { currentUserQueryKey } from "@/lib/session"
import { hasUnsavedWork } from "@/lib/unsaved-work"
import { ADMIN_TRACE_ID, adminServer, type AdminServerOptions, etagOf } from "@/test/admin-api"
import { mockBoardApi, requestsTo } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { admin, serviceAdvisor, viewer } from "@/test/identities"
import { problemResponse } from "@/test/mock-api"
import { renderBoard, viewportOf } from "@/test/render-board"
import { bodyRows } from "@/test/resource-list"
import { appointments, bays, technicians } from "@/test/schedules"
import { readingTuesdayWithCompetence, vehicleAwareOff, vehicleAwareOn } from "@/test/vehicle"

// Task 30b: an Admin edits the roster in the Resources area (Refine core's useForm over the Admin reads, the app's own
// fields), confirms a migrated HV level in one action, and deactivates a technician after seeing which upcoming
// appointments would then be flagged. Every write carries the version it was made from; a stale one is answered with what
// changed and a choice to reapply or discard. A Service advisor and a Viewer see the list read-only, with the reason.

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
const otherAdmin: CurrentUserResponse = { ...admin, email: "another.admin@keyloop.test", displayName: "Another Admin" }

interface Setup extends Omit<AdminServerOptions, "me"> {
  me?: CurrentUserResponse
  vehicleAware?: boolean
  range?: AppointmentListItemResponse[]
}

function setup({ me = admin, vehicleAware = true, range, ...options }: Setup = {}) {
  const session = { me }
  const server = adminServer({ me: () => session.me, ...options })
  const api = mockBoardApi({
    me: () => session.me,
    features: () => (vehicleAware ? vehicleAwareOn : vehicleAwareOff),
    schedule: () => readingTuesdayWithCompetence,
    range: range ? () => range : undefined,
    admin: server,
  })
  return { session, server, api, ...renderBoard(page) }
}

const table = () => screen.findByRole("table", { name: "Technicians" })
const writes = (requests: readonly Request[], method: string) =>
  requests.filter((request) => request.method === method && new URL(request.url).pathname.includes("/technicians"))
const bodyOf = async (request: Request) => request.clone().json()

async function rowAction(name: string, action: string) {
  fireEvent.click(await screen.findByRole("button", { name: `Actions for ${name}` }))
  fireEvent.click(await screen.findByRole("menuitem", { name: action }))
}

/** Opens a technician's form and waits for the record it edits. */
async function editForm(name: string) {
  await table()
  await rowAction(name, "Edit")
  const sheet = await screen.findByRole("dialog", { name: `Edit ${name}` })
  await waitFor(() => expect(within(sheet).getByRole("textbox", { name: "Name" })).toHaveValue(name))
  return sheet
}

/** The table row of a technician. */
const rowOf = (list: HTMLElement, name: string) => bodyRows(list).find((row) => row.textContent?.includes(name))

const save = (sheet: HTMLElement) => fireEvent.click(within(sheet).getByRole("button", { name: "Save changes" }))
const ben = technicians.ben

describe("editing technicians, as an Admin", () => {
  it("holds off a silent session renewal while the edit sheet is open", async () => {
    setup()

    expect(hasUnsavedWork()).toBe(false)
    const sheet = await editForm("Amelia Clarke")
    expect(hasUnsavedWork()).toBe(true)
    fireEvent.keyDown(sheet, { key: "Escape" })
    await waitFor(() => expect(sheet).not.toBeInTheDocument())
    expect(hasUnsavedWork()).toBe(false)
  })

  it("offers Add technician and each row's actions", async () => {
    setup()

    await table()
    expect(screen.getByRole("button", { name: "Add technician" })).not.toHaveAttribute("aria-disabled", "true")
    fireEvent.click(screen.getByRole("button", { name: "Actions for Ben Okafor" }))
    const items = (await screen.findAllByRole("menuitem")).map((item) => item.textContent)
    expect(items).toEqual(["Edit", "Deactivate", "Change history"])
  })

  it("edits from the record read fresh and saves the whole state with the version it was read at", async () => {
    const { server, api } = setup()

    const sheet = await editForm("Amelia Clarke")
    expect(within(sheet).getByRole("textbox", { name: "Employee number" })).toHaveValue("T-1001")
    // The competence block: the IMI-style levels, valid until in the dealership's calendar, confirmed, the brands.
    expect(within(sheet).getByRole("radiogroup", { name: "HV level" })).toBeInTheDocument()
    expect(within(sheet).getByRole("radio", { name: /^Level 2, Routine maintenance/ })).toBeChecked()
    expect(within(sheet).getByLabelText("Valid until")).toHaveValue("2028-12-31")
    expect(within(sheet).getByText(/the last day it counts, on Keyloop Motors Reading's calendar \(Europe\/London\)/i)).toBeInTheDocument()
    expect(within(sheet).getByRole("checkbox", { name: "Level confirmed" })).toBeChecked()
    expect(within(sheet).getByText("Not used for allocation yet")).toBeInTheDocument()
    expect(requestsTo(api.requests, `/technicians/${technicians.amelia.id}`)).toHaveLength(1)

    fireEvent.change(within(sheet).getByRole("textbox", { name: "Employee number" }), { target: { value: "T-2001" } })
    fireEvent.click(within(sheet).getByRole("radio", { name: /^Level 3, Component repair/ }))
    fireEvent.click(within(sheet).getByRole("checkbox", { name: "Wheel alignment" }))
    save(sheet)

    expect(await screen.findByText("Technician saved")).toBeInTheDocument()
    const [put] = writes(api.requests, "PUT")
    expect(put.headers.get("If-Match")).toBe(etagOf(712))
    expect(await bodyOf(put)).toEqual({
      name: "Amelia Clarke",
      employeeNumber: "T-2001",
      certifications: ["GeneralService", "Brakes", "MotTester", "WheelAlignment"],
      isActive: true,
      hvLevel: 3,
      hvLevelValidUntil: "2028-12-31",
      hvLevelConfirmed: true,
      brandSpecialisms: ["VOLKSWAGEN"],
    })
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Amelia Clarke" })).not.toBeInTheDocument())
    // The list is read again and shows the saved record.
    await waitFor(async () => expect(rowOf(await table(), "Amelia Clarke")).toHaveTextContent("HV 3"))
    expect(server.state.technicians[0].employeeNumber).toBe("T-2001")
    // Focus goes back to the row's actions.
    await waitFor(() => expect(screen.getByRole("button", { name: "Actions for Amelia Clarke" })).toHaveFocus())
  })

  it("sets the expiry, an unlimited level and the brand specialisms", async () => {
    const { api } = setup()

    const sheet = await editForm("Farid Haddad")
    fireEvent.change(within(sheet).getByLabelText("Valid until"), { target: { value: "2027-06-30" } })
    const brand = within(sheet).getByRole("textbox", { name: "Add a brand" })
    fireEvent.change(brand, { target: { value: "bmw!" } })
    fireEvent.click(within(sheet).getByRole("button", { name: "Add brand" }))
    expect(within(sheet).getByText("Use letters, digits and hyphens, starting with a letter or digit, up to 32 characters.")).toBeInTheDocument()
    fireEvent.change(brand, { target: { value: "bmw" } })
    fireEvent.keyDown(brand, { key: "Enter" })
    expect(within(sheet).getByRole("button", { name: "Remove BMW" })).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole("button", { name: "Remove VOLKSWAGEN" }))
    // The chip went with its button: focus is on the brand field.
    expect(brand).toHaveFocus()
    save(sheet)

    await screen.findByText("Technician saved")
    expect(await bodyOf(writes(api.requests, "PUT")[0])).toMatchObject({ hvLevelValidUntil: "2027-06-30", brandSpecialisms: ["BMW"] })

    const again = await editForm("Farid Haddad")
    fireEvent.click(within(again).getByRole("checkbox", { name: "Does not expire" }))
    expect(within(again).getByLabelText("Valid until")).toBeDisabled()
    save(again)
    await waitFor(() => expect(writes(api.requests, "PUT")).toHaveLength(2))
    expect(await bodyOf(writes(api.requests, "PUT")[1])).toMatchObject({ hvLevelValidUntil: null })
  })

  it("checks the form before sending: each error under its field, named by it, and focus on the first", async () => {
    const { api } = setup()

    const sheet = await editForm("Ben Okafor")
    const name = within(sheet).getByRole("textbox", { name: "Name" })
    fireEvent.change(name, { target: { value: "   " } })
    save(sheet)

    const error = await within(sheet).findByText("Enter the technician's name.")
    expect(name).toHaveAttribute("aria-invalid", "true")
    expect(name.getAttribute("aria-describedby")).toContain(error.id)
    await waitFor(() => expect(name).toHaveFocus())
    expect(writes(api.requests, "PUT")).toHaveLength(0)
  })

  it("puts the API's field errors under their fields", async () => {
    setup({
      refuse: (request) =>
        request.method === "PUT"
          ? problemResponse(400, {
              type: "https://api.keyloop.example/problems/validation-error",
              title: "Validation failed",
              status: 400,
              traceId: ADMIN_TRACE_ID,
              errors: { employeeNumber: ["This employee number is already used at the dealership."] },
            })
          : undefined,
    })

    const sheet = await editForm("Ben Okafor")
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Employee number" }), { target: { value: "T-1001" } })
    save(sheet)

    expect(await within(sheet).findByText("This employee number is already used at the dealership.")).toBeInTheDocument()
    expect(within(sheet).getByRole("textbox", { name: "Employee number" })).toHaveAttribute("aria-invalid", "true")
  })

  it("adds a technician, sent without a version", async () => {
    const { api } = setup()

    await table()
    fireEvent.click(screen.getByRole("button", { name: "Add technician" }))
    const sheet = await screen.findByRole("dialog", { name: "Add technician" })
    await waitFor(() => expect(within(sheet).getByRole("textbox", { name: "Name" })).toHaveFocus())
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Name" }), { target: { value: "Grace Hall" } })
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Employee number" }), { target: { value: "T-1007" } })
    fireEvent.click(within(sheet).getByRole("checkbox", { name: "General service" }))
    fireEvent.click(within(sheet).getByRole("button", { name: "Add technician" }))

    expect(await screen.findByText("Technician added")).toBeInTheDocument()
    const [post] = writes(api.requests, "POST")
    expect(post.headers.has("If-Match")).toBe(false)
    expect(await bodyOf(post)).toEqual({
      name: "Grace Hall",
      employeeNumber: "T-1007",
      certifications: ["GeneralService"],
      isActive: true,
      hvLevel: 0,
      hvLevelValidUntil: null,
      hvLevelConfirmed: true,
      brandSpecialisms: [],
    })
    await waitFor(async () => expect(within(await table()).getByText("Grace Hall")).toBeInTheDocument())
  })

  it("says what changed when another Admin saved first, and reapplies this Admin's changes over it", async () => {
    const { server, api } = setup()

    const sheet = await editForm("Ben Okafor")
    const now = server.editedElsewhere.technician(ben.id, { hvLevel: 2, employeeNumber: "T-9002" })
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Name" }), { target: { value: "Benjamin Okafor" } })
    save(sheet)

    const conflict = await within(sheet).findByRole("region", { name: "Someone else changed Ben Okafor" })
    expect(within(conflict).getByRole("row", { name: /HV level HV 3 HV 2/ })).toBeInTheDocument()
    expect(within(conflict).getByRole("row", { name: /Employee number T-1002 T-9002/ })).toBeInTheDocument()
    expect(within(conflict).getByRole("row", { name: /Name Ben Okafor Ben Okafor Benjamin Okafor/ })).toBeInTheDocument()
    // The conflict takes focus: the Save that was pressed is no longer the next step.
    await waitFor(() => expect(conflict).toHaveFocus())

    fireEvent.click(within(conflict).getByRole("button", { name: "Reapply my changes" }))
    await waitFor(() => expect(within(sheet).getByRole("textbox", { name: "Name" })).toHaveValue("Benjamin Okafor"))
    expect(within(sheet).getByRole("button", { name: "Save changes" })).toHaveFocus()
    expect(within(sheet).getByRole("radio", { name: /^Level 2, Routine maintenance/ })).toBeChecked()
    expect(within(sheet).getByRole("textbox", { name: "Employee number" })).toHaveValue("T-9002")
    expect(within(sheet).getByRole("status")).toHaveTextContent("Your changes are applied to the latest version. Check them, then save.")
    save(sheet)

    expect(await screen.findByText("Technician saved")).toBeInTheDocument()
    const [stale, reapplied] = writes(api.requests, "PUT")
    expect(stale.headers.get("If-Match")).toBe(etagOf(722))
    expect(reapplied.headers.get("If-Match")).toBe(etagOf(now.version))
    expect(await bodyOf(reapplied)).toMatchObject({ name: "Benjamin Okafor", hvLevel: 2, employeeNumber: "T-9002" })
  })

  it("discards this Admin's changes after a conflict when asked, and shows the record as it is now", async () => {
    const { server, api } = setup()

    const sheet = await editForm("Ben Okafor")
    server.editedElsewhere.technician(ben.id, { hvLevel: 2 })
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Name" }), { target: { value: "Benjamin Okafor" } })
    save(sheet)
    const conflict = await within(sheet).findByRole("region", { name: "Someone else changed Ben Okafor" })
    fireEvent.click(within(conflict).getByRole("button", { name: "Discard my changes" }))

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Ben Okafor" })).not.toBeInTheDocument())
    expect(writes(api.requests, "PUT")).toHaveLength(1)
    await waitFor(async () => expect(rowOf(await table(), "Ben Okafor")).toHaveTextContent("HV 2"))
  })

  it("says plainly when an edit left without its version (428), and reads the record again", async () => {
    setup({
      refuse: (request) =>
        request.method === "PUT"
          ? problemResponse(428, {
              type: "https://api.keyloop.example/problems/precondition-required",
              title: "Precondition required",
              status: 428,
              detail: "Send the ETag from the resource read in If-Match.",
              traceId: ADMIN_TRACE_ID,
            })
          : undefined,
    })

    const sheet = await editForm("Ben Okafor")
    save(sheet)

    const alert = await within(sheet).findByRole("alert")
    expect(alert).toHaveTextContent("Couldn’t save: the change went without the version it was made from")
    expect(alert).toHaveTextContent(ADMIN_TRACE_ID)
    expect(within(alert).getByRole("button", { name: "Reload" })).toBeInTheDocument()
  })

  // Reload after a 428 keeps what the Admin entered (Codex check of Task 30b): it reads the record again, and only a
  // change by someone else turns it into the comparison; nothing entered is dropped without Discard.
  const missingVersionOnce = () => {
    let refused = 0
    return (request: Request) =>
      request.method === "PUT" && refused++ === 0
        ? problemResponse(428, {
            type: "https://api.keyloop.example/problems/precondition-required",
            title: "Precondition required",
            status: 428,
            detail: "Send the ETag from the resource read in If-Match.",
            traceId: ADMIN_TRACE_ID,
          })
        : undefined
  }

  it("keeps what was entered when Reload finds the technician unchanged, and saves it with its version", async () => {
    const { api } = setup({ refuse: missingVersionOnce() })

    const sheet = await editForm("Ben Okafor")
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Name" }), { target: { value: "Benjamin Okafor" } })
    save(sheet)
    const alert = await within(sheet).findByRole("alert")
    fireEvent.click(within(alert).getByRole("button", { name: "Reload" }))

    expect(await within(sheet).findByRole("status")).toHaveTextContent("nobody has changed Ben Okafor since you opened it, and your changes are kept")
    expect(within(sheet).getByRole("button", { name: "Save changes" })).toHaveFocus()
    expect(within(sheet).getByRole("textbox", { name: "Name" })).toHaveValue("Benjamin Okafor")
    expect(within(sheet).queryByRole("alert")).not.toBeInTheDocument()
    save(sheet)

    expect(await screen.findByText("Technician saved")).toBeInTheDocument()
    const [refused, sent] = writes(api.requests, "PUT")
    expect(refused.headers.get("If-Match")).toBe(etagOf(722))
    expect(sent.headers.get("If-Match")).toBe(etagOf(722))
    expect(await bodyOf(sent)).toMatchObject({ name: "Benjamin Okafor" })
  })

  it("opens the comparison when Reload finds the technician changed by someone else, keeping what was entered", async () => {
    const { server, api } = setup({ refuse: missingVersionOnce() })

    const sheet = await editForm("Ben Okafor")
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Name" }), { target: { value: "Benjamin Okafor" } })
    save(sheet)
    const alert = await within(sheet).findByRole("alert")
    const now = server.editedElsewhere.technician(ben.id, { hvLevel: 2 })
    fireEvent.click(within(alert).getByRole("button", { name: "Reload" }))

    const conflict = await within(sheet).findByRole("region", { name: "Someone else changed Ben Okafor" })
    expect(within(conflict).getByRole("row", { name: /HV level HV 3 HV 2/ })).toBeInTheDocument()
    expect(within(conflict).getByRole("row", { name: /Name Ben Okafor Ben Okafor Benjamin Okafor/ })).toBeInTheDocument()
    await waitFor(() => expect(conflict).toHaveFocus())
    fireEvent.click(within(conflict).getByRole("button", { name: "Reapply my changes" }))
    await waitFor(() => expect(within(sheet).getByRole("textbox", { name: "Name" })).toHaveValue("Benjamin Okafor"))
    save(sheet)

    expect(await screen.findByText("Technician saved")).toBeInTheDocument()
    const sent = writes(api.requests, "PUT").at(-1)!
    expect(sent.headers.get("If-Match")).toBe(etagOf(now.version))
    expect(await bodyOf(sent)).toMatchObject({ name: "Benjamin Okafor", hvLevel: 2 })
  })

  it("says so when Reload cannot read the technician, keeping the form and the way to try again", async () => {
    const reads = { refuse: false }
    setup({
      refuse: missingVersionOnce(),
      refuseRead: (request) =>
        reads.refuse && new URL(request.url).pathname.endsWith(`/technicians/${ben.id}`)
          ? problemResponse(503, { type: "about:blank", title: "Service unavailable", status: 503, traceId: ADMIN_TRACE_ID })
          : undefined,
    })

    const sheet = await editForm("Ben Okafor")
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Name" }), { target: { value: "Benjamin Okafor" } })
    save(sheet)
    const alert = await within(sheet).findByRole("alert")
    reads.refuse = true
    fireEvent.click(within(alert).getByRole("button", { name: "Reload" }))

    expect(await within(alert).findByText("Couldn’t read it again. Check the connection, then reload once more.")).toBeInTheDocument()
    expect(within(sheet).getByRole("textbox", { name: "Name" })).toHaveValue("Benjamin Okafor")
    expect(within(alert).getByRole("button", { name: "Reload" })).toBeEnabled()
  })
})

describe("HV levels and deactivation, as an Admin", () => {
  const benUnconfirmed: Setup = { technicians: (records) => records.map((record) => (record.id === ben.id ? { ...record, hvLevelConfirmed: false } : record)) }

  it("confirms an unconfirmed level in one action, with the version it was shown at", async () => {
    const { api, server } = setup(benUnconfirmed)

    const note = await screen.findByRole("region", { name: "HV levels to review" })
    expect(note).toHaveTextContent("Ben Okafor")
    within(note).getByRole("button", { name: "Confirm Ben Okafor's level" }).focus()
    fireEvent.click(within(note).getByRole("button", { name: "Confirm Ben Okafor's level" }))

    expect(await screen.findByText("HV level confirmed")).toBeInTheDocument()
    // The button (and the note, with the last level) goes: focus is on Ben's row actions, not the page.
    expect(screen.getByRole("button", { name: "Actions for Ben Okafor" })).toHaveFocus()
    const [post] = requestsTo(api.requests, "/confirm-hv-level")
    expect(post.method).toBe("POST")
    expect(post.headers.get("If-Match")).toBe(etagOf(722))
    expect(server.state.technicians[1].hvLevelConfirmed).toBe(true)
    await waitFor(() => expect(screen.queryByRole("region", { name: "HV levels to review" })).not.toBeInTheDocument())
  })

  it("offers Confirm HV level in the row's menu while a level is unconfirmed", async () => {
    setup(benUnconfirmed)

    await table()
    fireEvent.click(screen.getByRole("button", { name: "Actions for Ben Okafor" }))
    expect(await screen.findByRole("menuitem", { name: "Confirm HV level" })).toBeInTheDocument()
  })

  it("shows the level as it is now when it changed before the confirmation, and confirms that one only when asked", async () => {
    const { api, server } = setup(benUnconfirmed)

    const note = await screen.findByRole("region", { name: "HV levels to review" })
    const now = server.editedElsewhere.technician(ben.id, { hvLevel: 2 })
    fireEvent.click(within(note).getByRole("button", { name: "Confirm Ben Okafor's level" }))

    const dialog = await screen.findByRole("dialog", { name: "Ben Okafor's record changed" })
    expect(within(dialog).getByRole("row", { name: /HV level HV 3 HV 2/ })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm HV 2" }))

    expect(await screen.findByText("HV level confirmed")).toBeInTheDocument()
    // Confirmed through the dialog: it closes onto Ben's row actions, as the review note and its button go.
    await waitFor(() => expect(screen.getByRole("button", { name: "Actions for Ben Okafor" })).toHaveFocus())
    const posts = requestsTo(api.requests, "/confirm-hv-level")
    expect(posts.map((request) => request.headers.get("If-Match"))).toEqual([etagOf(722), etagOf(now.version)])
  })

  it("keeps focus on the technician after confirming through the dialog when another Admin renamed them", async () => {
    const { server } = setup(benUnconfirmed)

    const note = await screen.findByRole("region", { name: "HV levels to review" })
    // A rename that moves Ben to the end of the name-sorted list: rows are keyed by record, so his row keeps its element.
    server.editedElsewhere.technician(ben.id, { hvLevel: 2, name: "Zach Okafor" })
    within(note).getByRole("button", { name: "Confirm Ben Okafor's level" }).focus()
    fireEvent.click(within(note).getByRole("button", { name: "Confirm Ben Okafor's level" }))
    const dialog = await screen.findByRole("dialog", { name: "Ben Okafor's record changed" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm HV 2" }))

    expect(await screen.findByText("HV level confirmed")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole("region", { name: "HV levels to review" })).not.toBeInTheDocument())
    // The row is the same element under its new name and place: focus is on its actions, never another technician's.
    await waitFor(() => expect(screen.getByRole("button", { name: "Actions for Zach Okafor" })).toHaveFocus())
    expect(bodyRows(await table()).at(-1)).toHaveTextContent("Zach Okafor")
  })

  it("moves focus to the search field when a concurrent rename takes the confirmed technician out of the search", async () => {
    const { server } = setup(benUnconfirmed)

    const note = await screen.findByRole("region", { name: "HV levels to review" })
    const search = screen.getByRole("searchbox", { name: "Search technicians" })
    fireEvent.change(search, { target: { value: "Ben" } })
    await waitFor(() => expect(bodyRows(screen.getByRole("table", { name: "Technicians" }))).toHaveLength(1))
    server.editedElsewhere.technician(ben.id, { hvLevel: 2, name: "Zach Okafor" })
    within(note).getByRole("button", { name: "Confirm Ben Okafor's level" }).focus()
    fireEvent.click(within(note).getByRole("button", { name: "Confirm Ben Okafor's level" }))
    const dialog = await screen.findByRole("dialog", { name: "Ben Okafor's record changed" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm HV 2" }))

    expect(await screen.findByText("HV level confirmed")).toBeInTheDocument()
    // Read again, "Zach Okafor" no longer matches "Ben": his row goes, and focus with it would be lost; it lands on the search.
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Actions for (Ben|Zach) Okafor$/ })).not.toBeInTheDocument())
    await waitFor(() => expect(search).toHaveFocus())
  })

  it("returns focus by record after two conflicts in a row, on Cancel and on confirming", async () => {
    const { server } = setup(benUnconfirmed)

    const note = await screen.findByRole("region", { name: "HV levels to review" })
    server.editedElsewhere.technician(ben.id, { hvLevel: 2, name: "Zach Okafor" })
    within(note).getByRole("button", { name: "Confirm Ben Okafor's level" }).focus()
    fireEvent.click(within(note).getByRole("button", { name: "Confirm Ben Okafor's level" }))
    let dialog = await screen.findByRole("dialog", { name: "Ben Okafor's record changed" })
    server.editedElsewhere.technician(ben.id, { hvLevel: 1, name: "Zachary Okafor" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm HV 2" }))
    // The second conflict: the dialog shows the level as it is now again.
    dialog = await screen.findByRole("dialog", { name: /record changed$/ })
    await within(dialog).findByRole("button", { name: "Confirm HV 1" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))

    // Cancel: back to Ben's own Confirm button, found by record whatever the dialog last called him.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    await waitFor(() => expect((document.activeElement as HTMLElement).dataset.recordId).toBe(ben.id))
    expect(within(note).getByRole("button", { name: /^Confirm .*'s level$/ })).toHaveFocus()

    fireEvent.click(document.activeElement as HTMLElement)
    dialog = await screen.findByRole("dialog", { name: /record changed$/ })
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm HV 1" }))
    expect(await screen.findByText("HV level confirmed")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole("region", { name: "HV levels to review" })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole("button", { name: "Actions for Zachary Okafor" })).toHaveFocus())
  })

  it("moves focus to the search field when a search hides the technician whose level was just confirmed", async () => {
    setup(benUnconfirmed)

    const note = await screen.findByRole("region", { name: "HV levels to review" })
    const search = screen.getByRole("searchbox", { name: "Search technicians" })
    fireEvent.change(search, { target: { value: "Eva" } })
    await waitFor(() => expect(screen.queryByRole("button", { name: "Actions for Ben Okafor" })).not.toBeInTheDocument())
    within(note).getByRole("button", { name: "Confirm Ben Okafor's level" }).focus()
    fireEvent.click(within(note).getByRole("button", { name: "Confirm Ben Okafor's level" }))

    expect(await screen.findByText("HV level confirmed")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole("region", { name: "HV levels to review" })).not.toBeInTheDocument())
    expect(search).toHaveFocus()
  })

  it("previews the upcoming appointments that would be flagged before deactivating, then deactivates", async () => {
    const upcoming = (id: string, date: string, status: AppointmentListItemResponse["status"], technician = ben) => ({
      ...appointments.evBattery,
      id,
      technician,
      status,
      bay: bays.ev,
      startUtc: `${date}T08:00:00Z`,
      endUtc: `${date}T09:00:00Z`,
      startLocal: `${date}T09:00+01:00`,
      endLocal: `${date}T10:00+01:00`,
    })
    const { api } = setup({
      range: [
        upcoming("a1", "2026-10-13", "Confirmed"),
        upcoming("a2", "2026-10-15", "Confirmed"),
        upcoming("a3", "2026-10-16", "Cancelled"),
        upcoming("a4", "2026-10-16", "Confirmed", technicians.amelia),
      ],
    })

    await table()
    await rowAction("Ben Okafor", "Deactivate")
    const dialog = await screen.findByRole("dialog", { name: "Deactivate Ben Okafor?" })
    expect(await within(dialog).findByText("2 upcoming appointments would be flagged for review")).toBeInTheDocument()
    expect(within(dialog).getByText("Tuesday 13 October, 09:00–10:00")).toBeInTheDocument()
    expect(within(dialog).getByText("Thursday 15 October, 09:00–10:00")).toBeInTheDocument()
    const [range] = requestsTo(api.requests, `/dealerships/${reading.id}/appointments`)
    expect(new URL(range.url).search).toBe("?from=2026-10-13&to=2026-12-13")

    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }))
    expect(await screen.findByText("Technician deactivated")).toBeInTheDocument()
    const [put] = writes(api.requests, "PUT")
    expect(put.headers.get("If-Match")).toBe(etagOf(722))
    expect(await bodyOf(put)).toMatchObject({ name: "Ben Okafor", isActive: false, hvLevel: 3 })
  })

  it("reactivates an inactive technician", async () => {
    const { api } = setup({ technicians: (records) => records.map((record) => (record.id === ben.id ? { ...record, isActive: false } : record)) })

    await table()
    await rowAction("Ben Okafor", "Reactivate")
    const dialog = await screen.findByRole("dialog", { name: "Reactivate Ben Okafor?" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Reactivate" }))

    expect(await screen.findByText("Technician reactivated")).toBeInTheDocument()
    expect(await bodyOf(writes(api.requests, "PUT")[0])).toMatchObject({ isActive: true })
  })

  it("keeps the competence out of the form with vehicle-aware requirements off, and sends it unchanged", async () => {
    const { api } = setup({ vehicleAware: false })

    const sheet = await editForm("Eva Lindqvist")
    expect(within(sheet).queryByRole("radiogroup", { name: "HV level" })).not.toBeInTheDocument()
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Name" }), { target: { value: "Eva Lindqvist-Berg" } })
    save(sheet)

    await screen.findByText("Technician saved")
    expect(await bodyOf(writes(api.requests, "PUT")[0])).toMatchObject({
      name: "Eva Lindqvist-Berg",
      hvLevel: 3,
      hvLevelValidUntil: "2028-12-31",
      hvLevelConfirmed: true,
      brandSpecialisms: ["VOLKSWAGEN"],
    })
  })
})

describe("the technicians list for other roles", () => {
  it.each([
    ["a Service advisor", serviceAdvisor],
    ["a Viewer", viewer],
  ])("is read-only for %s, with the reason, and reads nothing an Admin reads", async (_, me) => {
    const { api } = setup({ me })

    await table()
    const add = screen.getByRole("button", { name: "Add technician" })
    expect(add).toHaveAttribute("aria-disabled", "true")
    const reason = document.getElementById(add.getAttribute("aria-describedby")!)
    expect(reason).toHaveTextContent("Your role can view technicians but not change them. Changes are made by a workshop Admin.")
    expect(screen.queryByRole("button", { name: /^Actions for/ })).not.toBeInTheDocument()
    expect(requestsTo(api.requests, "/technicians")).toHaveLength(0)
  })

  it("says who can confirm an unconfirmed level, without offering it", async () => {
    setup({ me: viewer, technicians: (records) => records.map((record) => ({ ...record, hvLevelConfirmed: record.id !== ben.id })) })

    // The schedule carries the competence to a Viewer: the fixture's levels are confirmed, so no note.
    await table()
    expect(screen.queryByRole("button", { name: /^Confirm/ })).not.toBeInTheDocument()
  })
})

describe("an open form when who is signed in changes", () => {
  it("is closed without saving, and says so, when another Admin signs in", async () => {
    const { session, api, queryClient } = setup()

    const sheet = await editForm("Ben Okafor")
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Name" }), { target: { value: "Benjamin Okafor" } })
    session.me = otherAdmin
    act(() => queryClient.setQueryData(currentUserQueryKey(), otherAdmin))

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Ben Okafor" })).not.toBeInTheDocument())
    expect(await screen.findByText("The technician you were editing was closed without saving: who is signed in changed.")).toBeInTheDocument()
    expect(screen.queryByDisplayValue("Benjamin Okafor")).not.toBeInTheDocument()
    expect(writes(api.requests, "PUT")).toHaveLength(0)
  })

  it("stays open, with what was entered, when the same Admin gains another role", async () => {
    const { session, api, queryClient } = setup()

    const sheet = await editForm("Ben Okafor")
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Name" }), { target: { value: "Benjamin Okafor" } })
    const alsoViewer = { ...admin, roles: ["Admin", "Viewer"] }
    session.me = alsoViewer
    act(() => queryClient.setQueryData(currentUserQueryKey(), alsoViewer))
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)))

    expect(screen.getByRole("dialog", { name: "Edit Ben Okafor" })).toBeInTheDocument()
    expect(within(sheet).getByRole("textbox", { name: "Name" })).toHaveValue("Benjamin Okafor")
    save(sheet)
    expect(await screen.findByText("Technician saved")).toBeInTheDocument()
    expect(await bodyOf(writes(api.requests, "PUT")[0])).toMatchObject({ name: "Benjamin Okafor" })
  })

  it("is closed, and the list becomes read-only, when the Admin becomes a Viewer", async () => {
    const { session, api, queryClient } = setup()

    await editForm("Ben Okafor")
    session.me = viewer
    act(() => queryClient.setQueryData(currentUserQueryKey(), viewer))

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Ben Okafor" })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole("button", { name: "Add technician" })).toHaveAttribute("aria-disabled", "true"))
    expect(writes(api.requests, "PUT")).toHaveLength(0)
  })
})

describe("on a phone", () => {
  it("opens the form full height from a card's actions", async () => {
    viewportOf(390)
    setup()

    const cards = await screen.findByRole("list", { name: "Technicians" })
    fireEvent.click(within(cards).getByRole("button", { name: "Actions for Ben Okafor" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }))
    const sheet = await screen.findByRole("dialog", { name: "Edit Ben Okafor" })
    expect(sheet).toHaveAttribute("data-side", "bottom")
  })
})
