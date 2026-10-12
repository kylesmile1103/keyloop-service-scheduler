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
