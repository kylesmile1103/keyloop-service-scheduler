import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { mockBoardApi } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { pointerClick, renderBoard } from "@/test/render-board"
import { interimServiceType } from "@/test/schedules"
import {
  assessmentServiceType,
  brakesServiceType,
  diagnosticsServiceType,
  triageAnswer,
  triageEnabled,
} from "@/test/triage"

// Task 32b: the booking dialog's triage after the stakeholder's testing (2026-10-13).

beforeAll(async () => {
  await import("@/app/dispatch/page")
})

const readingBoard = `/dispatch?dealership=${reading.id}`
const catalogue = () => [interimServiceType, brakesServiceType, diagnosticsServiceType, assessmentServiceType]
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
