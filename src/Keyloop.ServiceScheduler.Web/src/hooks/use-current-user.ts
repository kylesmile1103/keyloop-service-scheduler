import { type QueryClient, useQuery } from "@tanstack/react-query"

import type { CurrentUserResponse } from "@/api/types.gen"
import { useQueryFailure } from "@/hooks/use-query-failure"
import {
  cachedIdentity,
  cachedWriter,
  type Capabilities,
  capabilitiesOf,
  currentUserQuery,
  currentUserQueryKey,
  type IdentitySource,
  identityKey,
  identitySource,
  knownRoles,
  LOGOUT_PATH,
  NO_ROLE_REASON,
  READ_ONLY_REASON,
  type Role,
  adminWriterOf,
  writerOf,
} from "@/lib/session"

export interface CurrentUser extends Capabilities {
  /** `loading` until first response; `failed` when the latest `/me` fetch failed (treated as signed out). */
  status: "loading" | "ready" | "failed"
  /** Latest user response, or `undefined` when `failed` or `loading`. */
  user: CurrentUserResponse | undefined
  /** Identity fingerprint (`identityKey`), or `"loading"` / `"failed"`. */
  identity: string
  authenticated: boolean
  roles: Role[]
  /** Email of the signed-in account when authorised to write, else `null`. */
  writer: string | null
  /** Email of the signed-in Admin when authorised for admin writes, else `null`. */
  adminWriter: string | null
  logoutUrl: string | null
  source: IdentitySource
  error: unknown
  fetching: boolean
  refetch: () => void
}

/**
 * Queries the signed-in identity (`GET /api/v1/me`) and its capabilities.
 * Withdraws capabilities immediately if a re-read fails, even while cached data exists.
 */
export function useCurrentUser(): CurrentUser {
  const options = currentUserQuery()
  const query = useQuery(options)
  const failure = useQueryFailure(query, options.queryKey)
  const failed = failure !== null || query.failureCount > 0
  const user = failed ? undefined : query.data
  return {
    status: failed ? "failed" : user ? "ready" : "loading",
    user,
    identity: user ? identityKey(user) : failed ? "failed" : "loading",
    authenticated: user?.authenticated === true,
    roles: user?.authenticated ? knownRoles(user.roles) : [],
    writer: writerOf(user),
    adminWriter: adminWriterOf(user),
    ...capabilitiesOf(user),
    logoutUrl: user?.logoutUrl ? LOGOUT_PATH : null,
    source: identitySource(),
    error: failure ?? query.failureReason,
    fetching: query.isFetching,
    refetch: () => void query.refetch(),
  }
}

/** Write-permission state for booking and workshop actions. */
export type WriteAccess =
  | { state: "checking" }
  | { state: "allowed" }
  | { state: "sign-in" }
  | { state: "denied"; reason: string }

export function writeAccessOf(current: Pick<CurrentUser, "status" | "authenticated" | "canWrite" | "roles">): WriteAccess {
  if (current.status === "loading") return { state: "checking" }
  if (!current.authenticated) return { state: "sign-in" }
  if (current.canWrite) return { state: "allowed" }
  return { state: "denied", reason: current.roles.length > 0 ? READ_ONLY_REASON : NO_ROLE_REASON }
}

export function useWriteAccess(): WriteAccess {
  return writeAccessOf(useCurrentUser())
}

/** Evaluates `WriteAccess` synchronously from the current `/me` query cache at the moment an action is triggered. */
export function cachedWriteAccess(queryClient: QueryClient): WriteAccess {
  if (cachedWriter(queryClient) !== null) return { state: "allowed" }
  const user = cachedIdentity(queryClient)
  const state = queryClient.getQueryState<CurrentUserResponse>(currentUserQueryKey())
  const failed =
    !user && state !== undefined && (state.status === "error" || state.fetchFailureCount > 0 || (state.data === undefined && state.errorUpdateCount > 0))
  return writeAccessOf({
    status: user ? "ready" : failed ? "failed" : "loading",
    authenticated: user?.authenticated === true,
    roles: user?.authenticated ? knownRoles(user.roles) : [],
    canWrite: false,
  })
}

/** Access state for reading full appointment details (contact info, vehicle, notes). */
export type DetailsAccess = "checking" | "allowed" | "sign-in" | "no-role"

export function detailsAccessOf(current: CurrentUser): DetailsAccess {
  if (current.status === "loading") return "checking"
  if (!current.authenticated) return "sign-in"
  return current.canViewDetails ? "allowed" : "no-role"
}
