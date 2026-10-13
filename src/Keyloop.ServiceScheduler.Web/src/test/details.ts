import { fireEvent, screen, within } from "@testing-library/react"

/** Finds the desktop appointment details inspector (`role="complementary"`). */
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
