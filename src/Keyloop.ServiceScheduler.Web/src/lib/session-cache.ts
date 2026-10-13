import type { Query, QueryClient } from "@tanstack/react-query"

import { cachedWriterFor, type WriteKind } from "@/lib/session"

/** Query operation IDs whose responses are caller-independent and retained across identity changes. */
const CALLER_INDEPENDENT = new Set(["getCurrentUser", "getDealerships", "getServiceTypes", "getBookingTriageStatus", "getFeatures"])

function operationId(query: Query): string | null {
  const first: unknown = query.queryKey[0]
  return typeof first === "object" && first !== null && "_id" in first && typeof first._id === "string" ? first._id : null
}

/** Returns true when a query's data may depend on the current caller. */
export function holdsCallerData(query: Query): boolean {
  const id = operationId(query)
  return id === null || !CALLER_INDEPENDENT.has(id)
}

const generations = new WeakMap<QueryClient, number>()

/** Monotonic generation counter incremented whenever caller-dependent cache data is cleared. */
export function callerGeneration(queryClient: QueryClient): number {
  return generations.get(queryClient) ?? 0
}

/** Thrown when a mutation response arrives after the signed-in caller changed. */
export class CallerChangedError extends Error {
  constructor() {
    super("Who is signed in changed before the answer arrived, so it was not used.")
    this.name = "CallerChangedError"
  }
}

/** Thrown when a mutation is blocked because the cached identity does not match the bound writer account. */
export class WriteNotAllowedError extends Error {
  constructor() {
    super("Who is signed in is not the account this change was made for, so nothing was sent.")
    this.name = "WriteNotAllowedError"
  }
}

/** Binds a write operation to a specific writer account and caller generation. */
export interface BoundWrite {
  /** Wraps `fetch` so each request verifies the cached writer identity and caller generation before sending. */
  fetch(base?: typeof fetch): typeof fetch
  /** Throws `CallerChangedError` or `WriteNotAllowedError` if the caller changed or no longer matches the bound owner. */
  guard(): void
  /** Returns true if the caller generation has changed since the write began or sent its first request. */
  stale(): boolean
}

/** Creates a `BoundWrite` guard for `owner` and the given write `kind` (`bookings` or `admin`). */
export function bindWrite(queryClient: QueryClient, owner: string | null, kind: WriteKind = "bookings"): BoundWrite {
  let generation = callerGeneration(queryClient)
  let left = false
  const isOwner = () => owner !== null && cachedWriterFor(kind, queryClient) === owner
  const stale = () => callerGeneration(queryClient) !== generation
  return {
    fetch: (base) => (input, init) => {
      if (left && stale()) return Promise.reject(new CallerChangedError())
      if (!isOwner()) return Promise.reject(new WriteNotAllowedError())
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

/** Resets active caller-dependent queries, removes inactive ones, and purges settled mutations on identity change. */
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

/** Refetches all active caller-dependent queries for the current identity. */
export function refetchCallerData(queryClient: QueryClient): Promise<void> {
  return queryClient.refetchQueries({ predicate: holdsCallerData, type: "active" })
}
