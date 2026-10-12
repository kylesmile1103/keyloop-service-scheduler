import { type QueryClient, useQuery } from "@tanstack/react-query"

import type { CurrentUserResponse } from "@/api/types.gen"
import { useQueryFailure } from "@/hooks/use-query-failure"
import {
  type Capabilities,
  capabilitiesOf,
  currentUserQuery,
  currentUserQueryKey,
  identityAnswered,
  type IdentitySource,
  identityKey,
  identitySource,
  knownRoles,
  LOGOUT_PATH,
  NO_ROLE_REASON,
  READ_ONLY_REASON,
  type Role,
} from "@/lib/session"

export interface CurrentUser extends Capabilities {
  /**
   * `loading` until the first answer; `failed` when the last read of `/me` failed, even after an earlier answer and while
   * it is tried again (treated as signed out: nobody is known, so nothing is allowed).
   */
  status: "loading" | "ready" | "failed"
  /** The last answer, kept while it is read again; none while `failed` (an answer from before the failure is not trusted). */
  user: CurrentUserResponse | undefined
  /**
   * Who the screen is for: the answer's fingerprint (`identityKey`), or `loading` / `failed`. A view that keeps something
   * read as one caller outside the query cache (a selected booking's snapshot, a booking being entered) drops it when this
   * changes, in the same render, so it never paints for the next caller.
   */
  identity: string
  authenticated: boolean
  roles: Role[]
  /** Where Sign out leads (the hostname's Access logout), when `/me` offers one; Sign in builds its own (`signInHref`). */
  logoutUrl: string | null
  source: IdentitySource
  /** The failure behind `failed`. */
  error: unknown
  /** True while `/me` is being read (again), Try again or TanStack's own retry included. */
  fetching: boolean
  refetch: () => void
}

/**
 * The signed-in identity (`GET /api/v1/me`) and what it may do. Every component asks the same cached query, which is
 * read again when the window regains focus. Until the first answer nothing is allowed, so a write control never shows as
 * usable and then changes its mind; and a read that fails withdraws everything at once, though TanStack keeps the earlier
 * answer in the cache: whoever was signed in may have signed out since (`cachedCapabilities` decides the same way).
 */
export function useCurrentUser(): CurrentUser {
  const options = currentUserQuery()
  const query = useQuery(options)
  // Kept while Try again reads it again, so a failed check stays failed (and its Try again focused) until the answer.
  const failure = useQueryFailure(query, options.queryKey)
  // A failed attempt counts at once, before TanStack's own retry (lib/query-client.ts) has its answer.
  const failed = failure !== null || query.failureCount > 0
  const user = failed ? undefined : query.data
  return {
    status: failed ? "failed" : user ? "ready" : "loading",
    user,
    identity: user ? identityKey(user) : failed ? "failed" : "loading",
    authenticated: user?.authenticated === true,
    roles: user?.authenticated ? knownRoles(user.roles) : [],
    ...capabilitiesOf(user),
    logoutUrl: user?.logoutUrl ? LOGOUT_PATH : null,
    source: identitySource(),
    error: failure ?? query.failureReason,
    fetching: query.isFetching,
    refetch: () => void query.refetch(),
  }
}

/**
 * Whether a control that changes bookings (book, cancel, suggest a service, upload a photo) may act:
 * - `checking` until `/me` answers: the control is unavailable, without a reason yet;
 * - `allowed` for Admin and ServiceAdvisor;
 * - `sign-in` for an anonymous visitor (or when `/me` failed): the control offers sign-in instead of sending a request
 *   the API would refuse with 401;
 * - `denied` for a signed-in account without a writing role: the control is unavailable, with the reason on screen.
 */
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

/**
 * `writeAccessOf` for the `/me` the cache holds at this moment, for a decision taken when a control is pressed rather than
 * when the page was drawn: a press can land after `/me` changed (signed out in another tab, a role removed, a failed
 * re-read) but before React has rendered the change, and the page's own `WriteAccess` is then the previous caller's. The
 * same source as a write's check as it is sent (`cachedCapabilities`): the last answer only while its last read succeeded
 * (`identityAnswered`); a read that failed, or is being read again after failing, counts as signed out, as
 * `useCurrentUser` counts it; nothing read yet is `checking`.
 */
export function cachedWriteAccess(queryClient: QueryClient): WriteAccess {
  const state = queryClient.getQueryState<CurrentUserResponse>(currentUserQueryKey())
  const user = identityAnswered(state) ? state?.data : undefined
  // TanStack puts a query without data back to `pending` while it is read again, so a failure shows only in its count.
  const failed =
    !user && state !== undefined && (state.status === "error" || state.fetchFailureCount > 0 || (state.data === undefined && state.errorUpdateCount > 0))
  return writeAccessOf({
    status: user ? "ready" : failed ? "failed" : "loading",
    authenticated: user?.authenticated === true,
    roles: user?.authenticated ? knownRoles(user.roles) : [],
    ...capabilitiesOf(user),
  })
}

/**
 * Whether a booking's full record (contact details, vehicle, notes) may be read: `allowed` for any role; `sign-in` for an
 * anonymous visitor; `no-role` for an account the administrator has not given a role; `checking` until `/me` answers.
 * Neither `sign-in` nor `no-role` sends the read the API would refuse.
 */
export type DetailsAccess = "checking" | "allowed" | "sign-in" | "no-role"

export function detailsAccessOf(current: CurrentUser): DetailsAccess {
  if (current.status === "loading") return "checking"
  if (!current.authenticated) return "sign-in"
  return current.canViewDetails ? "allowed" : "no-role"
}
