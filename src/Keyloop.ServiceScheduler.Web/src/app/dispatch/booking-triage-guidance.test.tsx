import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { BookAppointmentRequest } from "@/api/types.gen"
import { mockBoardApi } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { expectAvailable, expectUnavailableButFocusable } from "@/test/focus"
import { pointerClick, renderBoard } from "@/test/render-board"
import { interimServiceType } from "@/test/schedules"
import {
  assessmentServiceType,
  brakesServiceType,
  diagnosticsServiceType,
  triageAnswer,
  triageEnabled,
  uncovered,
} from "@/test/triage"

// Task 32b: the booking dialog's triage after the stakeholder's testing (2026-10-13).

beforeAll(async () => {
  await import("@/app/dispatch/page")
})

const readingBoard = `/dispatch?dealership=${reading.id}`
const catalogue = () => [interimServiceType, brakesServiceType, diagnosticsServiceType, assessmentServiceType]
const noMatch = "The workshop’s bookable services do not cover what you described."
const inspection = "Book Diagnostic Fault Finding for an inspection"
const crashNotice =
  "Also mentioned: accident or body damage, which Diagnostic Fault Finding does not cover. One appointment books one service: add it to Notes or book it separately."
const assessmentHelp = "Inspection and estimate of collision damage, not the repair itself."

beforeEach(() => {
  // Tuesday 2026-10-13, 09:30 in Reading (BST). Only Date is faked; timers stay real for the UI.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

async function openDialog() {
  fireEvent.click(await screen.findByRole("button", { name: "Book appointment" }))
  return screen.findByRole("dialog", { name: "Book appointment" })
}

async function describeAndSuggest(scope: HTMLElement, text: string) {
  fireEvent.change(await within(scope).findByRole("textbox", { name: "Describe the issue" }), { target: { value: text } })
  fireEvent.click(within(scope).getByRole("button", { name: "Suggest a service" }))
}

/** The status region that reads each answer out (always on the page). */
const announcement = (scope: HTMLElement) =>
  within(scope)
    .getAllByRole("status")
    .find((region) => region.classList.contains("sr-only") && region.closest("section[aria-label='Suggest a service from the issue']"))

const bookingBody = async (requests: readonly Request[]) => {
  const [booking] = requests.filter((request) => request.method === "POST" && new URL(request.url).pathname.endsWith("/appointments"))
  return (await booking.clone().json()) as BookAppointmentRequest
}

function fillCustomerAndVehicle(scope: HTMLElement) {
  const values: Record<string, string> = {
    Name: "Grace Hopper",
    Email: "grace.hopper@example.com",
    Phone: "+44 7700 900123",
    VIN: "WVWZZZ1KZAW654321",
    Registration: "RK22 ABC",
    Make: "Volkswagen",
    Model: "Golf",
  }
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(within(scope).getByRole("textbox", { name: label }), { target: { value } })
  }
}

describe("a no-match", () => {
  it("says the bookable services do not cover it, and offers an inspection the dealership can book", async () => {
    mockBoardApi({ triageStatus: () => triageEnabled, serviceTypes: catalogue, triage: () => triageAnswer("no-match", []) })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "I crashed my Kia Sportage and headlines are broken")

    expect(await within(scope).findByText(noMatch)).toBeInTheDocument()
    expect(within(scope).getByText("You can also choose a service below or contact the workshop.")).toBeInTheDocument()
    expect(within(scope).queryByText(/^Mentioned/)).not.toBeInTheDocument()
    expect(within(scope).queryByRole("radiogroup", { name: "Suggested services" })).not.toBeInTheDocument()
    expect(announcement(scope)).toHaveTextContent(
      `${noMatch} Book Diagnostic Fault Finding for an inspection, choose a service below or contact the workshop.`
    )

    // The action chooses the inspection as Use this would: the service, the free starts read for it, focus on the first.
    fireEvent.click(within(scope).getByRole("button", { name: inspection }))
    await waitFor(() => expect(within(scope).getByRole("combobox", { name: "Service" })).toHaveTextContent("Diagnostic Fault Finding"))
    // Nothing was asked about a day: the board's stays.
    expect(within(scope).getByRole("button", { name: /^Date, / })).toHaveAccessibleName("Date, Tuesday 13 October 2026")
    await waitFor(() => expect(within(scope).getByRole("radio", { name: /^10:15/ })).toHaveFocus())
    expectUnavailableButFocusable(within(scope).getByRole("button", { name: "Diagnostic Fault Finding in use" }))
  })

  it.each([
    { case: "cannot book it", serviceTypes: () => [interimServiceType, { ...diagnosticsServiceType, bookable: false }] },
    { case: "does not offer it", serviceTypes: () => [interimServiceType, brakesServiceType] },
  ])("offers no inspection when the dealership $case, and still says what to do", async ({ serviceTypes }) => {
    mockBoardApi({ triageStatus: () => triageEnabled, serviceTypes, triage: () => triageAnswer("no-match", []) })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "Can you deliver a pizza?")

    expect(await within(scope).findByText(noMatch)).toBeInTheDocument()
    expect(within(scope).getByText("Choose a service below, or contact the workshop.")).toBeInTheDocument()
    expect(within(scope).queryByRole("button", { name: /for an inspection$/ })).not.toBeInTheDocument()
    expect(announcement(scope)).toHaveTextContent(`${noMatch} Choose a service below, or contact the workshop.`)
  })

  it("names what was described in its fixed words when the answer gives a category", async () => {
    mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      triage: () => triageAnswer("no-match", [], null, uncovered("LIGHTS_OR_ELECTRICAL_ACCESSORY", null)),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "My headlight bulb has blown, please replace it")

    const mentioned = await within(scope).findByText("lights or electrical accessories")
    expect(mentioned.closest("p")).toHaveTextContent("Mentioned lights or electrical accessories")
    expect(announcement(scope)).toHaveTextContent(
      `${noMatch} Mentioned: lights or electrical accessories. Book Diagnostic Fault Finding for an inspection, choose a service below or contact the workshop.`
    )
    // A no-match is not "also": nothing else was booked for it to sit beside.
    expect(within(scope).queryByText(/^Also mentioned/)).not.toBeInTheDocument()
    expect(within(scope).queryByRole("button", { name: "Add to Notes" })).not.toBeInTheDocument()
  })
})

describe("what else the description mentioned", () => {
  it("says it beside the suggestion, naming the service it is outside, in a polite region that takes no focus", async () => {
    mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      // The stakeholder's sentence as the Task 32a report shapes it: diagnosis for the air-con, the crash left uncovered.
      triage: () =>
        triageAnswer("suggest", [[diagnosticsServiceType, 0.53]], null, uncovered("ACCIDENT_OR_BODY_DAMAGE", diagnosticsServiceType)),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "I crashed my Kia Sportage and headlines are broken, also the AC can't turn on")
    const suggest = within(scope).getByRole("button", { name: "Suggest a service" })
    suggest.focus()

    const notice = await within(scope).findByText(crashNotice)
    expect(notice.closest("[aria-live='polite']")).not.toBeNull()
    expect(announcement(scope)).toHaveTextContent(`Likely: Diagnostic Fault Finding, 53%. ${crashNotice} Check it, then choose Use this.`)
    expect(suggest).toHaveFocus()
    expectAvailable(within(scope).getByRole("button", { name: "Add to Notes" }))
  })

  it("does not name a service when the answer gives none, and stays whichever candidate is chosen", async () => {
    mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      triage: () =>
        triageAnswer("confirm", [[diagnosticsServiceType, 0.45], [brakesServiceType, 0.4]], null, uncovered("GLASS", null)),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "Warning light and a cracked windscreen")

    const notice = "Also mentioned: glass damage. One appointment books one service: add it to Notes or book it separately."
    expect(await within(scope).findByText(notice)).toBeInTheDocument()
    fireEvent.click(within(scope).getByRole("radio", { name: /^Brake Pads & Discs/ }))
    await waitFor(() => expect(within(scope).getByRole("radio", { name: /^Brake Pads & Discs/ })).toHaveAttribute("aria-checked", "true"))
    expect(within(scope).getByText(notice)).toBeInTheDocument()
  })

  it("goes while another candidate than the service it is outside is chosen, and comes back with it", async () => {
    mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      triage: () =>
        triageAnswer(
          "confirm",
          [[diagnosticsServiceType, 0.45], [brakesServiceType, 0.4]],
          null,
          uncovered("ACCIDENT_OR_BODY_DAMAGE", diagnosticsServiceType)
        ),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "Crashed, and a noise from the front")

    // Nothing chosen yet: the notice says which service the damage is outside.
    expect(await within(scope).findByText(crashNotice)).toBeInTheDocument()
    fireEvent.click(within(scope).getByRole("radio", { name: /^Brake Pads & Discs/ }))
    await waitFor(() => expect(within(scope).queryByText(crashNotice)).not.toBeInTheDocument())
    fireEvent.click(within(scope).getByRole("radio", { name: /^Diagnostic Fault Finding/ }))
    expect(await within(scope).findByText(crashNotice)).toBeInTheDocument()
  })

  it("shows nothing extra when the answer reports nothing else", async () => {
    mockBoardApi({ triageStatus: () => triageEnabled, serviceTypes: catalogue, triage: () => triageAnswer("suggest", [[brakesServiceType, 0.9]]) })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "Brakes squeal")

    await within(scope).findByRole("radio", { name: /^Brake Pads & Discs/ })
    expect(within(scope).queryByText(/Also mentioned/)).not.toBeInTheDocument()
    expect(within(scope).queryByRole("button", { name: "Add to Notes" })).not.toBeInTheDocument()
  })

  it("adds its line to Notes after the copied description, once, and books with it", async () => {
    const api = mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      triage: () =>
        triageAnswer("suggest", [[diagnosticsServiceType, 0.53]], null, uncovered("ACCIDENT_OR_BODY_DAMAGE", diagnosticsServiceType)),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "Crashed it, and the AC will not switch on")

    const add = await within(scope).findByRole("button", { name: "Add to Notes" })
    add.focus()
    fireEvent.click(add)
    // Done in place: the same button says so, keeps focus and cannot add the line twice.
    await waitFor(() => expect(add).toHaveAccessibleName("Added to Notes"))
    expect(add).toHaveFocus()
    expectUnavailableButFocusable(add)

    fireEvent.click(within(scope).getByRole("button", { name: "Use this" }))
    fireEvent.click(await within(scope).findByRole("radio", { name: /^10:15/ }))
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    const notes = await within(scope).findByRole("textbox", { name: "Notes for the workshop" })
    expect(notes).toHaveValue("Crashed it, and the AC will not switch on\nAlso mentioned: accident or body damage.")
    expect(notes).toHaveAccessibleDescription("Copied from the description of the issue. Notes are saved with the booking.")

    // Back on step 1 the line is still there, and the description's copy still follows the description.
    fireEvent.click(within(scope).getByRole("button", { name: "Back" }))
    expectUnavailableButFocusable(await within(scope).findByRole("button", { name: "Added to Notes" }))
    fireEvent.change(within(scope).getByRole("textbox", { name: "Describe the issue" }), { target: { value: "Crashed it" } })
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    expect(await within(scope).findByRole("textbox", { name: "Notes for the workshop" })).toHaveValue(
      "Crashed it\nAlso mentioned: accident or body damage."
    )
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))
    await screen.findByText("Booked")
    expect((await bookingBody(api.requests)).notes).toBe("Crashed it\nAlso mentioned: accident or body damage.")
  })

  it("adds only its line when the description is not copied, and says where the notes came from", async () => {
    mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      triage: () =>
        triageAnswer("suggest", [[diagnosticsServiceType, 0.53]], null, uncovered("ACCIDENT_OR_BODY_DAMAGE", diagnosticsServiceType)),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "Crashed it, call me on my mobile")
    fireEvent.click(within(scope).getByRole("checkbox", { name: "Copy the description into Notes" }))
    fireEvent.click(await within(scope).findByRole("button", { name: "Add to Notes" }))
    fireEvent.click(within(scope).getByRole("button", { name: "Use this" }))
    fireEvent.click(await within(scope).findByRole("radio", { name: /^10:15/ }))
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))

    const notes = await within(scope).findByRole("textbox", { name: "Notes for the workshop" })
    expect(notes).toHaveValue("Also mentioned: accident or body damage.")
    expect(notes).toHaveAccessibleDescription("Added from the suggestions on step 1. Notes are saved with the booking.")
  })

  it("adds its line after notes the person wrote, without replacing them", async () => {
    mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      triage: () =>
        triageAnswer("suggest", [[diagnosticsServiceType, 0.53]], null, uncovered("ACCIDENT_OR_BODY_DAMAGE", diagnosticsServiceType)),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "Crashed it, and the AC will not switch on")
    fireEvent.click(await within(scope).findByRole("button", { name: "Use this" }))
    fireEvent.click(await within(scope).findByRole("radio", { name: /^10:15/ }))
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    fireEvent.change(await within(scope).findByRole("textbox", { name: "Notes for the workshop" }), { target: { value: "Customer waiting" } })
    fireEvent.click(within(scope).getByRole("button", { name: "Back" }))

    fireEvent.click(await within(scope).findByRole("button", { name: "Add to Notes" }))
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    const notes = await within(scope).findByRole("textbox", { name: "Notes for the workshop" })
    expect(notes).toHaveValue("Customer waiting\nAlso mentioned: accident or body damage.")
    expect(notes).not.toHaveAccessibleDescription(/Copied from|Added from/)
  })
})

describe("Add to Notes within the 1000 characters Notes can hold", () => {
  // 40 characters, written after the person's own notes with a line break: their notes plus 41.
  const line = "Also mentioned: accident or body damage."
  const crashAnswer = () =>
    triageAnswer("suggest", [[diagnosticsServiceType, 0.53]], null, uncovered("ACCIDENT_OR_BODY_DAMAGE", diagnosticsServiceType))
  const ownNotes = (length: number) => "Customer waiting. ".repeat(60).slice(0, length)
  const tooLong = (over: number) =>
    `Notes must be shortened by ${over} ${over === 1 ? "character" : "characters"} to add this line. Notes can be at most 1000 characters.`

  /** The person's own notes typed on step 2, then back on step 1 where the notice is. */
  async function writeOwnNotes(scope: HTMLElement, text: string) {
    fireEvent.click(await within(scope).findByRole("button", { name: "Use this" }))
    fireEvent.click(await within(scope).findByRole("radio", { name: /^10:15/ }))
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    fireEvent.change(await within(scope).findByRole("textbox", { name: "Notes for the workshop" }), { target: { value: text } })
    fireEvent.click(within(scope).getByRole("button", { name: "Back" }))
  }

  it.each([
    { own: 958, total: 999 },
    { own: 959, total: 1000 },
  ])("adds its line when the notes then hold $total characters, and books with them", async ({ own, total }) => {
    const api = mockBoardApi({ triageStatus: () => triageEnabled, serviceTypes: catalogue, triage: crashAnswer })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "Crashed it, and the AC will not switch on")
    await writeOwnNotes(scope, ownNotes(own))

    const add = await within(scope).findByRole("button", { name: "Add to Notes" })
    add.focus()
    fireEvent.click(add)
    await waitFor(() => expect(add).toHaveAccessibleName("Added to Notes"))
    expect(add).toHaveFocus()
    expect(within(scope).queryByText(/Notes must be shortened/)).not.toBeInTheDocument()

    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    const notes = await within(scope).findByRole("textbox", { name: "Notes for the workshop" })
    expect(notes).toHaveValue(`${ownNotes(own)}\n${line}`)
    expect((notes as HTMLTextAreaElement).value).toHaveLength(total)
    fillCustomerAndVehicle(scope)
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))
    await screen.findByText("Booked")
    expect((await bookingBody(api.requests)).notes).toHaveLength(total)
  })

  it.each([
    { own: 960, over: 1 },
    { own: 1000, over: 41 },
  ])(
    "writes nothing when the line would take the notes $over over, keeps the person's words and says so in the notice",
    async ({ own, over }) => {
      mockBoardApi({ triageStatus: () => triageEnabled, serviceTypes: catalogue, triage: crashAnswer })
      renderBoard(readingBoard)
      const scope = await openDialog()
      await describeAndSuggest(scope, "Crashed it, and the AC will not switch on")
      await writeOwnNotes(scope, ownNotes(own))

      const add = await within(scope).findByRole("button", { name: "Add to Notes" })
      add.focus()
      fireEvent.click(add)
      // Said in the notice's polite region, tied to the button, which keeps focus and stays available for when there is room.
      const refusal = await within(scope).findByText(tooLong(over))
      expect(refusal.closest("[aria-live='polite']")).not.toBeNull()
      expect(refusal.closest("[role='alert']")).toBeNull()
      expect(add).toHaveAccessibleName("Add to Notes")
      expect(add).toHaveAccessibleDescription(tooLong(over))
      expect(add).toHaveFocus()
      expectAvailable(add)

      fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
      expect(await within(scope).findByRole("textbox", { name: "Notes for the workshop" })).toHaveValue(ownNotes(own))
    }
  )

  it("adds the line once the person has shortened their notes enough", async () => {
    mockBoardApi({ triageStatus: () => triageEnabled, serviceTypes: catalogue, triage: crashAnswer })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "Crashed it, and the AC will not switch on")
    await writeOwnNotes(scope, ownNotes(1000))
    fireEvent.click(await within(scope).findByRole("button", { name: "Add to Notes" }))
    expect(await within(scope).findByText(tooLong(41))).toBeInTheDocument()

    // Shortened, but not enough: back on step 1 the notice says how much is still to go.
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    fireEvent.change(await within(scope).findByRole("textbox", { name: "Notes for the workshop" }), { target: { value: ownNotes(970) } })
    fireEvent.click(within(scope).getByRole("button", { name: "Back" }))
    expect(await within(scope).findByText(tooLong(11))).toBeInTheDocument()

    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    fireEvent.change(await within(scope).findByRole("textbox", { name: "Notes for the workshop" }), { target: { value: ownNotes(959) } })
    fireEvent.click(within(scope).getByRole("button", { name: "Back" }))
    const add = await within(scope).findByRole("button", { name: "Add to Notes" })
    expect(within(scope).queryByText(/Notes must be shortened/)).not.toBeInTheDocument()
    fireEvent.click(add)
    await waitFor(() => expect(add).toHaveAccessibleName("Added to Notes"))
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    expect(await within(scope).findByRole("textbox", { name: "Notes for the workshop" })).toHaveValue(`${ownNotes(959)}\n${line}`)
  })

  it("counts the copied description too, where the status allows a description that long", async () => {
    mockBoardApi({ triageStatus: () => ({ ...triageEnabled, maxDescriptionLength: 1000 }), serviceTypes: catalogue, triage: crashAnswer })
    renderBoard(readingBoard)
    const scope = await openDialog()
    // The copy is the description, then the line: 960 + 1 + 40.
    await describeAndSuggest(scope, ownNotes(960))
    const add = await within(scope).findByRole("button", { name: "Add to Notes" })
    fireEvent.click(add)
    expect(await within(scope).findByText(tooLong(1))).toBeInTheDocument()
    expect(add).toHaveAccessibleName("Add to Notes")

    // One character less in the description, and the line fits: the description and the line, 1000 characters.
    fireEvent.change(within(scope).getByRole("textbox", { name: "Describe the issue" }), { target: { value: ownNotes(959) } })
    fireEvent.click(within(scope).getByRole("button", { name: "Suggest a service" }))
    const again = await within(scope).findByRole("button", { name: "Add to Notes" })
    await waitFor(() => expectAvailable(again))
    expect(within(scope).queryByText(/Notes must be shortened/)).not.toBeInTheDocument()
    fireEvent.click(again)
    await waitFor(() => expect(again).toHaveAccessibleName("Added to Notes"))
    fireEvent.click(within(scope).getByRole("button", { name: "Use this" }))
    fireEvent.click(await within(scope).findByRole("radio", { name: /^10:15/ }))
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    expect(await within(scope).findByRole("textbox", { name: "Notes for the workshop" })).toHaveValue(`${ownNotes(959)}\n${line}`)
  })
})

describe("the copy for the candidates the API returns", () => {
  it("reads naturally for a single likely service", async () => {
    mockBoardApi({ triageStatus: () => triageEnabled, serviceTypes: catalogue, triage: () => triageAnswer("suggest", [[diagnosticsServiceType, 0.53]]) })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "The AC can't turn on")

    const group = await within(scope).findByRole("radiogroup", { name: "Suggested services" })
    expect(within(group).getAllByRole("radio")).toHaveLength(1)
    expect(within(scope).getByText("This service fits the description. Check it, then use it.")).toBeInTheDocument()
    expect(within(scope).queryByText(/fits best/)).not.toBeInTheDocument()
  })

  it("reads naturally for a single possible service", async () => {
    mockBoardApi({ triageStatus: () => triageEnabled, serviceTypes: catalogue, triage: () => triageAnswer("confirm", [[brakesServiceType, 0.45]]) })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "A noise when I stop")

    await within(scope).findByRole("radio", { name: /^Brake Pads & Discs/ })
    expect(within(scope).getByText("This service could fit. Choose it if it matches, then use it.")).toBeInTheDocument()
    expect(announcement(scope)).toHaveTextContent("One service could fit: Brake Pads & Discs. Choose it if it matches, then choose Use this.")
  })

  it("shows every candidate the API returns, in its order, however small (the floors are the API's)", async () => {
    mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      triage: () => triageAnswer("suggest", [[brakesServiceType, 0.6], [diagnosticsServiceType, 0.31], [interimServiceType, 0.1]]),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "Brakes and a light")

    const group = await within(scope).findByRole("radiogroup", { name: "Suggested services" })
    expect(within(group).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "Brake Pads & Discs, 90 min, Likely 60%",
      "Diagnostic Fault Finding, 60 min, Possible 31%",
      "Interim Service, 60 min, Possible 10%",
    ])
    expect(within(scope).getByText("One service fits best. Check it, then use it.")).toBeInTheDocument()
  })
})

describe("the photo picker", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test-photo") })
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() })
  })
  const photo = (name = "front-wing.png", type = "image/png") => new File([new Uint8Array([137, 80, 78, 71])], name, { type })
  /** The whole field (its label, panel, limits and photos): photos dropped anywhere on it are taken. */
  const photoField = (scope: HTMLElement) => within(scope).getByLabelText("Photos or paperwork (optional)").closest<HTMLElement>("[data-slot='field']")!

  it("is an Add photos control over a visually hidden file input that the keyboard reaches, with its limits", async () => {
    mockBoardApi({ triageStatus: () => triageEnabled, serviceTypes: catalogue })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await within(scope).findByRole("textbox", { name: "Describe the issue" })

    const input = within(scope).getByLabelText("Photos or paperwork (optional)") as HTMLInputElement
    const control = within(scope).getByText("Add photos").closest("label")!
    // The visible control is a label for the input: a click on it opens the same file picker, and its words are in the name.
    expect(control.control).toBe(input)
    expect(input).toHaveAccessibleName("Photos or paperwork (optional) Add photos")
    // Hidden from sight, not from the keyboard: no native "Choose Files" or "No file chosen", and no tooltip of its own.
    expect(input).toHaveClass("sr-only")
    expect(input).toHaveAttribute("title", "")
    expect(input).not.toHaveAttribute("tabindex")
    input.focus()
    expect(input).toHaveFocus()
    expect(input).toHaveAttribute("type", "file")
    expect(input).toHaveAttribute("accept", "image/png,image/jpeg,image/webp")
    expect(input).toHaveAttribute("multiple")
    expect(input).toHaveAccessibleDescription(
      "Up to 4 PNG, JPEG or WebP photos, 4 MiB and 16 megapixels each, 8 MiB total. Uploads expire after one hour."
    )

    // The keyboard's choice (Enter or Space on the input) arrives as the input's change, like the picker's.
    fireEvent.change(input, { target: { files: [photo()] } })
    expect(within(scope).getByAltText("Selected photo: front-wing.png")).toBeInTheDocument()
    // The same input, still labelled Add photos, beside the photos: focus returning from the picker stays in the dialog.
    expect(within(scope).getByLabelText("Photos or paperwork (optional)")).toBe(input)
    expect(within(scope).getByText("Add photos").closest("label")!.control).toBe(input)
  })

  it("ties a refusal to the input, as its error and its description", async () => {
    mockBoardApi({ triageStatus: () => triageEnabled, serviceTypes: catalogue })
    renderBoard(readingBoard)
    const scope = await openDialog()
    const input = await within(scope).findByLabelText("Photos or paperwork (optional)")

    fireEvent.change(input, { target: { files: [new File(["paper"], "paper.pdf", { type: "application/pdf" })] } })
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(input).toHaveAccessibleDescription(expect.stringContaining("Choose PNG, JPEG or WebP photos."))
  })

  it("takes photos dropped on the field, keeping the browser from opening them", async () => {
    mockBoardApi({ triageStatus: () => triageEnabled, serviceTypes: catalogue })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await within(scope).findByRole("textbox", { name: "Describe the issue" })
    const field = photoField(scope)
    const files = [photo("front-wing.png"), photo("bumper.jpg", "image/jpeg")]

    expect(fireEvent.dragEnter(field, { dataTransfer: { types: ["Files"], files: [] } })).toBe(false)
    expect(field).toHaveAttribute("data-dragging")
    expect(fireEvent.dragOver(field, { dataTransfer: { types: ["Files"], files: [] } })).toBe(false)
    expect(fireEvent.drop(field, { dataTransfer: { types: ["Files"], files } })).toBe(false)

    expect(field).not.toHaveAttribute("data-dragging")
    expect(within(scope).getByAltText("Selected photo: front-wing.png")).toBeInTheDocument()
    expect(within(scope).getByAltText("Selected photo: bumper.jpg")).toBeInTheDocument()
    expect(within(scope).getByRole("list", { name: "Selected photos" }).children).toHaveLength(2)
  })

  it("checks dropped files as it checks chosen ones", async () => {
    const api = mockBoardApi({ triageStatus: () => triageEnabled, serviceTypes: catalogue })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await within(scope).findByRole("textbox", { name: "Describe the issue" })

    fireEvent.drop(photoField(scope), { dataTransfer: { types: ["Files"], files: [new File(["paper"], "paper.pdf", { type: "application/pdf" })] } })
    expect(within(scope).getByText("Choose PNG, JPEG or WebP photos.")).toBeInTheDocument()
    expect(within(scope).queryByRole("list", { name: "Selected photos" })).not.toBeInTheDocument()
    expect(api.requests.some((request) => request.method === "POST")).toBe(false)
  })

  it("ignores a drop while it is asking, as the input does", async () => {
    let answer: () => void = () => {}
    const held = new Promise<void>((resolve) => (answer = resolve))
    mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      triage: async () => (await held, triageAnswer("suggest", [[brakesServiceType, 0.85]])),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "Brakes squeal")
    await waitFor(() => expect(within(scope).getByLabelText("Photos or paperwork (optional)")).toBeDisabled())

    // Still kept from the browser, so a photo let go over the field never replaces the booking being entered.
    expect(fireEvent.drop(photoField(scope), { dataTransfer: { types: ["Files"], files: [photo()] } })).toBe(false)
    expect(within(scope).queryByRole("list", { name: "Selected photos" })).not.toBeInTheDocument()
    answer()
    await within(scope).findByRole("radio", { name: /^Brake Pads & Discs/ })
  })
})

describe("the accident damage assessment's help", () => {
  it("says what it is in the Service list, under the chosen service and on its suggested card", async () => {
    mockBoardApi({
      triageStatus: () => triageEnabled,
      serviceTypes: catalogue,
      triage: () => triageAnswer("suggest", [[assessmentServiceType, 0.85]]),
    })
    renderBoard(readingBoard)
    const scope = await openDialog()

    await describeAndSuggest(scope, "I crashed my car and the bumper is hanging off")
    const card = await within(scope).findByRole("radio", { name: /^Accident Damage Assessment/ })
    expect(card).toHaveAccessibleDescription(`${assessmentHelp} Needs: Damage assessment.`)
    expect(within(card).getByText(assessmentHelp)).toBeInTheDocument()

    fireEvent.click(within(scope).getByRole("combobox", { name: "Service" }))
    const option = await screen.findByRole("option", { name: /^Accident Damage Assessment/ })
    expect(option).toHaveTextContent(assessmentHelp)
    // Only the service it is written for.
    expect(screen.getByRole("option", { name: /^Brake Pads & Discs/ })).not.toHaveTextContent(assessmentHelp)
    pointerClick(option)

    await waitFor(() => expect(within(scope).getByRole("combobox", { name: "Service" })).toHaveTextContent("Accident Damage Assessment"))
    const field = within(scope).getByRole("combobox", { name: "Service" }).closest("[data-slot='field']") as HTMLElement
    expect(within(field).getByText(assessmentHelp)).toBeInTheDocument()
  })

  it("adds nothing to a service whose name says enough", async () => {
    mockBoardApi({ triageStatus: () => triageEnabled, serviceTypes: catalogue, triage: () => triageAnswer("suggest", [[brakesServiceType, 0.85]]) })
    renderBoard(readingBoard)
    const scope = await openDialog()
    await describeAndSuggest(scope, "Brakes squeal")

    expect(await within(scope).findByRole("radio", { name: /^Brake Pads & Discs/ })).toHaveAccessibleDescription("Needs: Brakes.")
    expect(within(scope).queryByText(assessmentHelp)).not.toBeInTheDocument()
  })
})
