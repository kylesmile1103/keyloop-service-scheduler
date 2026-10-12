/** The search parameter naming the dealership a workshop page shows: `?dealership=<id>`. */
export const DEALERSHIP_PARAM = "dealership"

/** The search parameter naming the day a workshop page shows (`yyyy-MM-dd`); without it the page shows today. */
export const DATE_PARAM = "date"

/**
 * What the workshop pages (the dispatch board and the appointments list) share in the address: both show one dealership's
 * day, so moving from one to the other keeps the dealership and the day.
 */
export const WORKSHOP_PARAMS: readonly string[] = [DEALERSHIP_PARAM, DATE_PARAM]

/** The search string (`?a=1&b=2`, or `""`) of the current address, keeping only the named parameters, in that order. */
export function carrySearch(search: string, names: readonly string[]): string {
  const current = new URLSearchParams(search)
  const kept = new URLSearchParams()
  for (const name of names) {
    const value = current.get(name)
    if (value !== null) kept.set(name, value)
  }
  const query = kept.toString()
  return query ? `?${query}` : ""
}
