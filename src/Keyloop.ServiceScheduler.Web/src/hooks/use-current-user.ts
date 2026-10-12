import { useQuery } from "@tanstack/react-query"

import type { CurrentUserResponse } from "@/api/types.gen"
import { useQueryFailure } from "@/hooks/use-query-failure"
import {
  type Capabilities,
  capabilitiesOf,
  currentUserQuery,
  type IdentitySource,
  identitySource,
  knownRoles,
  LOGOUT_PATH,
  NO_ROLE_REASON,
  READ_ONLY_REASON,
  type Role,
} from "@/lib/session"

export interface CurrentUser extends Capabilities {
  /** `loading` until the first answer; `failed` when `/me` could not be read and nothing is known (treated as signed out). */
  status: "loading" | "ready" | "failed"
  /** The last answer, kept while it is read again. */
  user: CurrentUserResponse | undefined
  authenticated: boolean
  roles: Role[]
  /** Where Sign out leads (the hostname's Access logout), when `/me` offers one; Sign in builds its own (`signInHref`). */
  logoutUrl: string | null
  source: IdentitySource
  /** The failure behind `failed`. */
  error: unknown
  /** True while `/me` is being read (again). */
  fetching: boolean
  refetch: () => void
}

/**
 * The signed-in identity (`GET /api/v1/me`) and what it may do. Every component asks the same cached query, which is
 * read again when the window regains focus. Until the first answer nothing is allowed, so a write control never shows as
 * usable and then changes its mind.
 */
export function useCurrentUser(): CurrentUser {
  const options = currentUserQuery()
  const query = useQuery(options)
  // Kept while Try again reads it again, so a failed check stays failed (and its Try again focused) until the answer.
  const failure = useQueryFailure(query, options.queryKey)
  const user = query.data
  return {
    status: user ? "ready" : failure !== null ? "failed" : "loading",
    user,
    authenticated: user?.authenticated === true,
    roles: user?.authenticated ? knownRoles(user.roles) : [],
    ...capabilitiesOf(user),
    logoutUrl: user?.logoutUrl ? LOGOUT_PATH : null,
    source: identitySource(),
    error: failure,
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

export function writeAccessOf(current: CurrentUser): WriteAccess {
  if (current.status === "loading") return { state: "checking" }
  if (!current.authenticated) return { state: "sign-in" }
  if (current.canWrite) return { state: "allowed" }
  return { state: "denied", reason: current.roles.length > 0 ? READ_ONLY_REASON : NO_ROLE_REASON }
}

export function useWriteAccess(): WriteAccess {
  return writeAccessOf(useCurrentUser())
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
