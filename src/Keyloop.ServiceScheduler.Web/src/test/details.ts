import { fireEvent, screen, within } from "@testing-library/react"

/**
 * A booking's details on a board 1280 px wide or wider (the tests' default 1440 px): the inspector docked beside the board,
 * a complementary landmark named "Appointment details" (UI_DESIGN 11.14). Narrower boards and the other pages use the sheet,
 * a dialog named by the service.
 */
export const findInspector = () => screen.findByRole("complementary", { name: "Appointment details" })

export const queryInspector = () => screen.queryByRole("complementary", { name: "Appointment details" })

/** Opens the cancellation's confirm in a booking's details (*Cancel booking…*) and returns its reason field. */
export function startCancelling(details: HTMLElement): HTMLElement {
  fireEvent.click(within(details).getByRole("button", { name: "Cancel booking…" }))
  return within(details).getByRole("textbox", { name: "Reason" })
}

/** Opens the confirm, types a reason and presses *Cancel appointment*. */
export function cancelWithReason(details: HTMLElement, reason: string) {
  fireEvent.change(startCancelling(details), { target: { value: reason } })
  fireEvent.click(within(details).getByRole("button", { name: "Cancel appointment" }))
}

/** Opens the Job card's "Why this allocation" disclosure and returns the explanation (a region of that name). */
export async function openExplanation(details: HTMLElement): Promise<HTMLElement> {
  fireEvent.click(await within(details).findByRole("button", { name: "Why this allocation" }))
  return within(details).findByRole("region", { name: "Why this allocation" })
}
