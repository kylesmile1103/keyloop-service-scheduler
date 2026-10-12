import { expect } from "vitest"

/**
 * A button that cannot act right now but keeps keyboard focus (Base UI `focusableWhenDisabled`): `aria-disabled`, never
 * the `disabled` attribute. A browser moves focus off a control that becomes disabled, to the top of the page (jsdom does
 * not, which is why the attribute is asserted and not only `toHaveFocus`).
 */
export function expectUnavailableButFocusable(button: HTMLElement) {
  expect(button).toHaveAttribute("aria-disabled", "true")
  expect(button).not.toBeDisabled()
}

/** The same button once it can act again. */
export function expectAvailable(button: HTMLElement) {
  expect(button).not.toHaveAttribute("aria-disabled", "true")
  expect(button).toBeEnabled()
}
