import { getCurrentUserOptions } from "@/api/@tanstack/react-query.gen"
import type { CurrentUserResponse } from "@/api/types.gen"

/**
 * Who is using the app, as `GET /api/v1/me` answers (ADR-027): the verified identity, its API roles and the Access login
 * and logout addresses. The app never sees a credential: the browser carries the hostname's Access cookie to the API,
 * signing in and out are top-level navigations to the URLs the API gives, and nothing here reads, stores or forwards a
 * token. What the roles allow mirrors the API's policies (`BookingsWrite`, `AppointmentDetails`); the API stays the
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

/** The API's login path, for the moment before `/me` has answered (it gives the same path). */
export const DEFAULT_LOGIN_URL = "/auth/login"

/**
 * The address to navigate to for signing in: the API's login URL with `returnTo` set to the local page to come back to
 * (path and search, so `?dealership=` and `?date=` survive). The API accepts only a local path there; the rest of its URL
 * is kept as given.
 */
export function signInHref(loginUrl: string, returnTo: string): string {
  const origin = window.location.origin
  const url = new URL(loginUrl || DEFAULT_LOGIN_URL, origin)
  url.searchParams.set("returnTo", returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/")
  return url.origin === origin ? `${url.pathname}${url.search}` : url.href
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
 * another component that asks for it mounts (TanStack's `retryOnMount`): with no data it would go back to loading, and a
 * view that mounts a reader only once it has failed (Settings > Account's Sign in) would ask again for ever. Try again,
 * the window's focus and the next refusal read it again.
 */
export const currentUserQuery = () => ({
  ...getCurrentUserOptions(),
  staleTime: 60_000,
  refetchOnWindowFocus: "always" as const,
  retryOnMount: false,
})

/** The `/me` query's key, to read it again after a refusal. */
export const currentUserQueryKey = () => getCurrentUserOptions().queryKey
