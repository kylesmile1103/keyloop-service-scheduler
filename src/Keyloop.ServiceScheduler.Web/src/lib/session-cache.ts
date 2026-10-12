import type { Query, QueryClient } from "@tanstack/react-query"

/**
 * Cache hygiene when the identity changes (ARCHITECTURE §15). The API answers the schedule, the range read and the
 * Resources area's lists with full names, VINs and plates for a role and masks them for everyone else, and a booking's
 * record goes only to a role; so whatever was read as one caller must not be shown to the next. These reads carry nothing
 * personal and do not depend on the caller, so they stay (an open booking dialog keeps its service list and suggestions
 * section): the identity itself, the dealerships, a dealership's catalogue and the triage status. Every other query, the
 * admin area's included, is cleared: deny by default, so a read added later is cleared too.
 */
const CALLER_INDEPENDENT = new Set(["getCurrentUser", "getDealerships", "getServiceTypes", "getBookingTriageStatus"])

/** The generated query key's operation id (`[{ _id: "getWorkshopSchedule", ... }]`), if it is one. */
function operationId(query: Query): string | null {
  const first: unknown = query.queryKey[0]
  return typeof first === "object" && first !== null && "_id" in first && typeof first._id === "string" ? first._id : null
}

/** Whether a query's data may depend on who asked: everything but the caller-independent reference reads. */
export function holdsCallerData(query: Query): boolean {
  const id = operationId(query)
  return id === null || !CALLER_INDEPENDENT.has(id)
}

/**
 * Drops what the previous caller read: a query nobody shows is removed; one on screen is reset to "never loaded" (its
 * request in flight is cancelled) so its view shows loading, not the old data. Finished mutations go too (their variables
 * and answers hold customers' details). The reset queries are read again by `refetchCallerData`, once the views have
 * rendered for the new identity, so a read the new caller may not make (a booking's record, for a visitor) is never sent.
 */
export function clearCallerData(queryClient: QueryClient): void {
  const queries = queryClient.getQueryCache()
  for (const query of queries.findAll({ predicate: holdsCallerData })) {
    if (query.isActive()) query.reset()
    else queries.remove(query)
  }
  const mutations = queryClient.getMutationCache()
  for (const mutation of mutations.getAll()) {
    if (mutation.state.status !== "pending") mutations.remove(mutation)
  }
}

/** Reads again, as the new caller, every cleared query a view still shows. */
export function refetchCallerData(queryClient: QueryClient): Promise<void> {
  return queryClient.refetchQueries({ predicate: holdsCallerData, type: "active" })
}
