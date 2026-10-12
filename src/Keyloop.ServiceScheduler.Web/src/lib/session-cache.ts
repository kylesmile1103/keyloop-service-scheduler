import type { Query, QueryClient } from "@tanstack/react-query"

import { cachedCapabilities } from "@/lib/session"

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

const generations = new WeakMap<QueryClient, number>()

/**
 * Which caller the cache is for, as a number that goes up with every change (`clearCallerData`): a write remembers it
 * when it is sent, and an answer that arrives under another one belongs to the previous caller (`useWriteMutation`).
 */
export function callerGeneration(queryClient: QueryClient): number {
  return generations.get(queryClient) ?? 0
}

/** A write's answer that arrived after who is signed in changed: thrown away, never shown or cached for the next caller. */
export class CallerChangedError extends Error {
  constructor() {
    super("Who is signed in changed before the answer arrived, so it was not used.")
    this.name = "CallerChangedError"
  }
}

/** A write stopped before it was sent: the identity in the cache may not write (signed out, a role that cannot, unknown). */
export class WriteNotAllowedError extends Error {
  constructor() {
    super("This account cannot change bookings, so nothing was sent.")
    this.name = "WriteNotAllowedError"
  }
}

/**
 * A check for one write, to call as it is sent and again after each step it awaits, before the next request: it throws
 * `CallerChangedError` once the caller has changed since the write began, and `WriteNotAllowedError` while the identity in
 * the cache may not write (`cachedCapabilities`), so no request leaves for a caller who cannot make it, whatever the
 * screen has drawn yet.
 */
export function writeGuard(queryClient: QueryClient): () => void {
  const generation = callerGeneration(queryClient)
  return () => {
    if (callerGeneration(queryClient) !== generation) throw new CallerChangedError()
    if (!cachedCapabilities(queryClient).canWrite) throw new WriteNotAllowedError()
  }
}

/**
 * Drops what the previous caller read: a query nobody shows is removed; one on screen is reset to "never loaded" (its
 * request in flight is cancelled) so its view shows loading, not the old data. Finished mutations go too (their variables
 * and answers hold customers' details), and one still running goes as soon as it settles (its answer is the previous
 * caller's: `useWriteMutation` throws it away). The reset queries are read again by `refetchCallerData`, once the views
 * have rendered for the new identity, so a read the new caller may not make (a booking's record, for a visitor) is never
 * sent.
 */
export function clearCallerData(queryClient: QueryClient): void {
  generations.set(queryClient, callerGeneration(queryClient) + 1)
  const queries = queryClient.getQueryCache()
  for (const query of queries.findAll({ predicate: holdsCallerData })) {
    if (query.isActive()) query.reset()
    else queries.remove(query)
  }
  const mutations = queryClient.getMutationCache()
  const running = new Set<object>()
  for (const mutation of mutations.getAll()) {
    if (mutation.state.status === "pending") running.add(mutation)
    else mutations.remove(mutation)
  }
  if (running.size === 0) return
  const stop = mutations.subscribe((event) => {
    if (event.type !== "updated" || !running.has(event.mutation) || event.mutation.state.status === "pending") return
    mutations.remove(event.mutation)
    running.delete(event.mutation)
    if (running.size === 0) stop()
  })
}

/** Reads again, as the new caller, every cleared query a view still shows. */
export function refetchCallerData(queryClient: QueryClient): Promise<void> {
  return queryClient.refetchQueries({ predicate: holdsCallerData, type: "active" })
}
