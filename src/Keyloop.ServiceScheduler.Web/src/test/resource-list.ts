import { fireEvent, screen, within } from "@testing-library/react"

/** The body rows of a table (the header row is in the first row group). */
export const bodyRows = (table: HTMLElement) => within(within(table).getAllByRole("rowgroup")[1]).getAllByRole("row")

/** The column headers' text. */
export const headers = (table: HTMLElement) => within(table).getAllByRole("columnheader").map((cell) => cell.textContent?.trim() ?? "")

/** What a column shows in each body row, by its header's text. */
export function columnTexts(table: HTMLElement, header: string): string[] {
  const index = headers(table).indexOf(header)
  if (index === -1) throw new Error(`no column "${header}"`)
  return bodyRows(table).map((row) => within(row).getAllByRole("cell")[index].textContent?.trim() ?? "")
}

/** A figure card by its label: its value and footer, as text. */
export function figure(label: string): HTMLElement {
  return screen.getByRole("group", { name: label })
}

/** Opens a faceted filter's popover from the toolbar. */
export async function openFilter(title: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${title} filter(,|$)`) }))
  return screen.findByRole("dialog", { name: title })
}
