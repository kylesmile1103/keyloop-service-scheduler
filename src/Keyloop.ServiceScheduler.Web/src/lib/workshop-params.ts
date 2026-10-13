/** URL search parameter for the selected dealership ID (`?dealership=<id>`). */
export const DEALERSHIP_PARAM = "dealership"

/** URL search parameter for the selected workshop date (`yyyy-MM-dd`). */
export const DATE_PARAM = "date"

/** Search parameters preserved when navigating between workshop views. */
export const WORKSHOP_PARAMS: readonly string[] = [DEALERSHIP_PARAM, DATE_PARAM]

/** Returns a query string (`?a=1&b=2` or `""`) preserving only `names` from `search` in order. */
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
