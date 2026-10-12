import type { QueryClient } from "@tanstack/react-query"

import { getCurrentUserOptions } from "@/api/@tanstack/react-query.gen"
import type { CurrentUserResponse } from "@/api/types.gen"

/**
 * Who is using the app, as `GET /api/v1/me` answers (ADR-027): the verified identity and its API roles. The app never
 * sees a credential: the browser carries the hostname's Access cookie to the API, signing in and out are top-level
 * navigations to the API's fixed same-origin login and logout paths, and nothing here reads, stores or forwards a token. What the roles allow mirrors the API's policies (`BookingsWrite`, `AppointmentDetails`); the API stays the
 * judge, and a refusal it sends anyway is answered in one place (components/auth/session-watch.tsx).
 */

/** The API's roles, in the order `/me` lists them. */
export const ROLES = ["Admin", "ServiceAdvisor", "Viewer"] as const
export type Role = (typeof ROLES)[number]

/** Each role as the screen names it. */
export const ROLE_LABELS: Record<Role, string> = {
  Admin: "Admin",
  ServiceAdvisor: "Service advisor",
  Viewer: "Viewer",
}

/** The roles the app knows, in the API's order; a name it does not know grants nothing here. */
export function knownRoles(roles: readonly string[] | undefined): Role[] {
  return ROLES.filter((role) => roles?.includes(role))
}

export interface Capabilities {
  /** Book, cancel, and ask for (and upload photos to) service suggestions: Admin or ServiceAdvisor (`BookingsWrite`). */
  canWrite: boolean
  /** A booking's contact details and vehicle, and unmasked names, VINs and plates: any role (`AppointmentDetails`). */
  canViewDetails: boolean
  /** The Resources area: any role; Admin-only editing arrives with Task 30. */
  canOpenResources: boolean
  isAdmin: boolean
}

/** What a caller may do, from `/me`. Without an answer (still loading, or failed) nothing is allowed. */
export function capabilitiesOf(user: CurrentUserResponse | undefined): Capabilities {
  const roles = user?.authenticated ? knownRoles(user.roles) : []
  const any = roles.length > 0
  return {
    canWrite: roles.includes("Admin") || roles.includes("ServiceAdvisor"),
    canViewDetails: any,
    canOpenResources: any,
    isAdmin: roles.includes("Admin"),
  }
}

/**
 * The account whose writes an identity may send: the email (lower case, as the API compares it) of an account that may
 * write, else `null`. A write, and a booking being entered, belong to this account: two roles that may write for the
 * same email are the same writer, anything else is another one (`useWriteMutation`, the booking dialog's draft).
 */
export function writerOf(user: CurrentUserResponse | undefined): string | null {
  return capabilitiesOf(user).canWrite ? (user?.email ?? "").toLowerCase() : null
}

/** The name to show for a signed-in user: the token's name, else the email. */
export function nameOf(user: CurrentUserResponse): string {
  return user.displayName?.trim() || user.email || "Signed-in user"
}

/**
 * An identity's fingerprint: whether it is signed in, its email and its roles. Two answers with the same fingerprint are
 * the same caller to the API's masking and policies; any difference means cached reads may hold another caller's view.
 */
export function identityKey(user: CurrentUserResponse): string {
  return [user.authenticated ? "in" : "out", user.email?.toLowerCase() ?? "", [...user.roles].sort().join(",")].join("|")
}

/**
 * The API's login path (`AuthUrls.Login`, ADR-027), on this origin: the only address Sign in ever leads to. `/me` and a
 * `401` problem carry a `loginUrl` too, always this path with `returnTo=/`; the app builds its own instead of following
 * one, so no answer (or anything that rewrites one on the way) can send a visitor to another origin or path.
 */
export const LOGIN_PATH = "/auth/login"

/** The hostname's Access logout (`AuthUrls.Logout`), the only address Sign out leads to. */
export const LOGOUT_PATH = "/cdn-cgi/access/logout"

/**
 * A page the login may come back to, checked as the API's `AuthUrls.SafeReturnTo` checks it: a local path (one leading
 * `/`, not `//`, so no scheme and no other host), without a backslash (browsers read `/\host` as `//host`), a control
 * character or a lone surrogate (which no URL can carry). Anything else is `/`.
 */
export function safeReturnTo(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/"
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    // `\`, C0 controls, DEL and C1 controls (.NET's `char.IsControl`).
    if (code === 0x5c || code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return "/"
    if (code >= 0xdc00 && code <= 0xdfff) return "/"
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1)
      if (!(low >= 0xdc00 && low <= 0xdfff)) return "/"
      index++
    }
  }
  return value
}

/**
 * The address to navigate to for signing in: the API's login path on this origin, with `returnTo` the local page to come
 * back to (path and search, so `?dealership=` and `?date=` survive), or `/` when that is not a safe local path.
 */
export function signInHref(returnTo: string): string {
  return `${LOGIN_PATH}?${new URLSearchParams({ returnTo: safeReturnTo(returnTo) })}`
}

/**
 * Where the identity comes from. `access`: Cloudflare Access, with a hosted login and logout (every built app). `configuration`:
 * the API's Development identity, set by its configuration (`Auth:Development:Roles`), so there is no login page to visit and
 * no session to end; the Vite dev server always runs against such an API (the AppHost's run mode, or `pnpm dev` beside the
 * API's Development profile). vite.config.ts compiles the value in.
 */
export type IdentitySource = "access" | "configuration"

export function identitySource(): IdentitySource {
  return import.meta.env.VITE_IDENTITY_SOURCE === "configuration" ? "configuration" : "access"
}

/** Why a signed-in user's control cannot change bookings. */
export const READ_ONLY_REASON = "Your role can view bookings but not change them."
export const NO_ROLE_REASON =
  "Your account has no workshop role yet, so it can view the board but not change bookings. The workshop administrator assigns roles."

/**
 * The `/me` read. Fresh for a minute, so moving between pages does not ask again, but read again whenever the window
 * regains focus, so signing in or out in another tab is noticed on return. A failed read is not read again just because
 * another component that asks for it mounts, whether or not an earlier answer is cached (TanStack's `retryOnMount`
 * covers only the case without one, and marks a failed re-read's data stale): with no data it would go back to loading,
 * and a view that mounts a reader only once it has failed (Settings > Account's Sign in, a prompt's Try again) would ask
 * again for ever. TanStack's own retry (lib/query-client.ts), Try again, the window's focus and the next refusal read it
 * again.
 */
export const currentUserQuery = () => ({
  ...getCurrentUserOptions(),
  staleTime: 60_000,
  refetchOnWindowFocus: "always" as const,
  refetchOnMount: (query: { state: { status: string } }) => query.state.status !== "error",
  retryOnMount: false,
})

/** The `/me` query's key, to read it again after a refusal. */
export const currentUserQueryKey = () => getCurrentUserOptions().queryKey

/**
 * Whether the cached `/me` can be trusted: its last read succeeded. A read that failed (even one TanStack is about to try
 * again, and even with an earlier answer still cached) leaves nobody known, so nothing is allowed until `/me` answers.
 */
export function identityAnswered(state: { status: string; fetchFailureCount: number } | undefined): boolean {
  return state?.status === "success" && state.fetchFailureCount === 0
}

/**
 * What the cached `/me` allows at this moment, for a decision taken outside rendering: a read's `enabled` when it would
 * run, a write as it is sent. Nothing unless its last read succeeded (`identityAnswered`), as `useCurrentUser` decides.
 */
export function cachedCapabilities(queryClient: QueryClient): Capabilities {
  const state = queryClient.getQueryState<CurrentUserResponse>(currentUserQueryKey())
  return capabilitiesOf(identityAnswered(state) ? state?.data : undefined)
}

/** The writer the cached `/me` names at this moment (`writerOf`), for a write as it is sent: nobody unless its last read succeeded. */
export function cachedWriter(queryClient: QueryClient): string | null {
  const state = queryClient.getQueryState<CurrentUserResponse>(currentUserQueryKey())
  return writerOf(identityAnswered(state) ? state?.data : undefined)
}

/**
 * Who the cached `/me` names at this moment (`identityKey`), for something kept outside the query cache as it arrives (a
 * write's answer kept by a view): `failed` unless its last read succeeded, as `useCurrentUser` names it.
 */
export function cachedIdentity(queryClient: QueryClient): string {
  const state = queryClient.getQueryState<CurrentUserResponse>(currentUserQueryKey())
  return identityAnswered(state) && state?.data ? identityKey(state.data) : "failed"
}
