/**
 * Answers a media query's width conditions (`(min-width: 1280px)`, `(max-width: 767px)`, joined with `and`) for a viewport
 * of the given width; any other feature (colour scheme, pointer) does not match. Enough for the app's breakpoint hooks.
 */
export function matchesWidth(query: string, width: number): boolean {
  const conditions = [...query.matchAll(/\((min|max)-width:\s*(\d+(?:\.\d+)?)px\)/g)]
  if (conditions.length === 0) return false
  return conditions.every(([, bound, value]) => (bound === "min" ? width >= Number(value) : width <= Number(value)))
}
