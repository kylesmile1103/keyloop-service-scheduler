import type { Query, QueryClient } from "@tanstack/react-query"

import { cachedWriter } from "@/lib/session"

/**
 * Cache hygiene when the identity changes (ARCHITECTURE §15). The API answers the schedule, the range read and the
 * Resources area's lists with full names, VINs and plates for a role and masks them for everyone else, and a booking's
 * record goes only to a role; so whatever was read as one caller must not be shown to the next. These reads carry nothing
 * personal and do not depend on the caller, so they stay (an open booking dialog keeps its service list, suggestions
 * section and vehicle step): the identity itself, the dealerships, a dealership's catalogue, the triage status and the
 * environment's feature switches. Every other query, the admin area's included, is cleared: deny by default, so a read
 * added later is cleared too (the vehicle-aware availability reads, whose keys carry the vehicle's profile, among them).
 */
const CALLER_INDEPENDENT = new Set(["getCurrentUser", "getDealerships", "getServiceTypes", "getBookingTriageStatus", "getFeatures"])

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

/**
 * A write stopped before its request left: the identity in the cache is not the account the write is bound to (signed
 * out, a role that cannot write, another account, or nobody known), so nothing was sent. Thrown when the write starts,
 * after a step it awaited, or by its fetch as the generated client hands it the request (`bindWrite`).
 */
export class WriteNotAllowedError extends Error {
  constructor() {
    super("Who is signed in is not the account this change was made for, so nothing was sent.")
    this.name = "WriteNotAllowedError"
  }
}

/**
 * One send of a write bound to `owner` (the account it is sent for, `writerOf`), as `useWriteMutation` runs it. The
 * account is checked last inside the fetch the generated client calls for each of the write's requests (`fetch`), so
 * nothing the client awaits before it (its auth parameters, its request interceptors) can let a request leave for another
 * caller. A write's requests all leave as one caller: its first request leaves as whoever the cache names then, if that is
 * `owner`; each later one only if who is signed in has not changed since (any change, the same email's included: what
 * the earlier requests answered was the previous caller's).
 */
export interface BoundWrite {
  /**
   * The `fetch` to give the generated client for each of this write's requests (its per-request `fetch` option), wrapping
   * `base` (a span's traced fetch; by default the page's `fetch`, looked up as the request leaves). The client calls it
   * once its own preparation is done, and it checks synchronously, immediately before handing the request to `base`, that
   * the identity in the cache is `owner` (`cachedWriter`: not signed out, not a role that cannot write, not another account,
   * and `/me`'s last read succeeded) and, for a later request, that the caller has not changed since the first left. If
   * not, the returned promise rejects (`WriteNotAllowedError`, or `CallerChangedError` for a later request after a change)
   * and `base` is never called, so nothing leaves.
   */
  fetch(base?: typeof fetch): typeof fetch
  /**
   * To call after each step the write awaits, before using what it answered or sending the next request: throws
   * `CallerChangedError` if who is signed in changed since the write's first request left (since it began, if none has),
   * else `WriteNotAllowedError` while the identity in the cache is not `owner`.
   */
  guard(): void
  /**
   * Whether who is signed in changed since the write's first request left (since it began, if none has): an answer
   * arriving now is the previous caller's.
   */
  stale(): boolean
}

export function bindWrite(queryClient: QueryClient, owner: string | null): BoundWrite {
  // The caller the write's requests leave as: until the first leaves, the caller it began under.
  let generation = callerGeneration(queryClient)
  let left = false
  const isOwner = () => owner !== null && cachedWriter(queryClient) === owner
  const stale = () => callerGeneration(queryClient) !== generation
  return {
    fetch: (base) => (input, init) => {
      if (left && stale()) return Promise.reject(new CallerChangedError())
      if (!isOwner()) return Promise.reject(new WriteNotAllowedError())
      // Nothing is awaited between these checks and the request leaving. Before the first request, a change between two
      // roles that may write for the same email is the same account: the write leaves as the caller the cache names now,
      // and its answers are theirs.
      generation = callerGeneration(queryClient)
      left = true
      return base ? base(input, init) : globalThis.fetch(input, init)
    },
    guard() {
      if (stale()) throw new CallerChangedError()
      if (!isOwner()) throw new WriteNotAllowedError()
    },
    stale,
  }
}

/**
 * Drops what the previous caller read: a query nobody shows is removed; one on screen is reset to "never loaded" (its
 * request in flight is cancelled) so its view shows loading, not the old data. Finished mutations go too (their variables
 * and answers hold customers' details), and one still running goes as soon as it settles (`useWriteMutation` throws its
 * answer away when its request left as the previous caller, and sends nothing for another account). The reset queries are
 * read again by `refetchCallerData`, once the views have rendered for the new identity, so a read the new caller may not
 * make (a booking's record, for a visitor) is never sent.
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
