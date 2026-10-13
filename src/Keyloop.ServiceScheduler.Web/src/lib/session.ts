import type { QueryClient } from "@tanstack/react-query"

import { getCurrentUserOptions } from "@/api/@tanstack/react-query.gen"
import type { CurrentUserResponse } from "@/api/types.gen"

/** Supported API roles in display order. */
export const ROLES = ["Admin", "ServiceAdvisor", "Viewer"] as const
export type Role = (typeof ROLES)[number]

/** User-facing labels for each API role. */
export const ROLE_LABELS: Record<Role, string> = {
  Admin: "Admin",
  ServiceAdvisor: "Service advisor",
  Viewer: "Viewer",
}

/** Filters raw role strings down to known `Role` values in canonical order. */
export function knownRoles(roles: readonly string[] | undefined): Role[] {
  return ROLES.filter((role) => roles?.includes(role))
}

export interface Capabilities {
  /** May create/cancel bookings and request or upload photos for service suggestions (`Admin` or `ServiceAdvisor`). */
  canWrite: boolean
  /** May view appointment contact/vehicle details and unmasked PII (any role). */
  canViewDetails: boolean
  /** May open the Resources area (any role). */
  canOpenResources: boolean
  /** May manage technicians, bays, requirement policies, HV confirmations, and audit history (`Admin`). */
  isAdmin: boolean
}

/** Computes caller capabilities from `/me` response data. */
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

/** Returns the lowercase email of a caller with booking write access, or `null`. */
export function writerOf(user: CurrentUserResponse | undefined): string | null {
  return capabilitiesOf(user).canWrite ? (user?.email ?? "").toLowerCase() : null
}

/** Write capability category: `bookings` (`Admin` or `ServiceAdvisor`) or `admin` (`Admin` only). */
export type WriteKind = "bookings" | "admin"

/** Returns the lowercase email of a caller with `Admin` access, or `null`. */
export function adminWriterOf(user: CurrentUserResponse | undefined): string | null {
  return capabilitiesOf(user).isAdmin ? (user?.email ?? "").toLowerCase() : null
}

/** Returns the writer account email for the given `WriteKind`, or `null`. */
export function writerFor(kind: WriteKind, user: CurrentUserResponse | undefined): string | null {
  return kind === "admin" ? adminWriterOf(user) : writerOf(user)
}

/** Returns the display name or email for a signed-in user. */
export function nameOf(user: CurrentUserResponse): string {
  return user.displayName?.trim() || user.email || "Signed-in user"
}

/** Stable identity fingerprint combining authentication status, lowercase email, and sorted roles. */
export function identityKey(user: CurrentUserResponse): string {
  return [user.authenticated ? "in" : "out", user.email?.toLowerCase() ?? "", [...user.roles].sort().join(",")].join("|")
}

/** Same-origin API login endpoint path. */
export const LOGIN_PATH = "/auth/login"

/** Same-origin Cloudflare Access logout endpoint path. */
export const LOGOUT_PATH = "/cdn-cgi/access/logout"

/** Validates that `value` is a safe local path (single leading `/`, no backslashes, control chars, or lone surrogates), falling back to `"/"`. */
export function safeReturnTo(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/"
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
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

/** Builds the same-origin sign-in URL with a validated `returnTo` query parameter. */
export function signInHref(returnTo: string): string {
  return `${LOGIN_PATH}?${new URLSearchParams({ returnTo: safeReturnTo(returnTo) })}`
}

/** Identity provider mode: `"access"` (Cloudflare Access) or `"configuration"` (local dev configuration). */
export type IdentitySource = "access" | "configuration"

export function identitySource(): IdentitySource {
  return import.meta.env.VITE_IDENTITY_SOURCE === "configuration" ? "configuration" : "access"
}

export const READ_ONLY_REASON = "Your role can view bookings but not change them."

/** Formats a read-only explanation for non-Admin users viewing resource management controls. */
export function adminOnlyReason(what: string): string {
  return `Your role can view ${what} but not change them. Changes are made by a workshop Admin.`
}
export const NO_ROLE_REASON =
  "Your account has no workshop role yet, so it can view the board but not change bookings. The workshop administrator assigns roles."

/** Query options for `GET /api/v1/me` with a 60-second stale time and window-focus revalidation. */
export const currentUserQuery = () => ({
  ...getCurrentUserOptions(),
  staleTime: 60_000,
  refetchOnWindowFocus: "always" as const,
  refetchOnMount: (query: { state: { status: string } }) => query.state.status !== "error",
  retryOnMount: false,
})

export const currentUserQueryKey = () => getCurrentUserOptions().queryKey

/** Returns true when the `/me` query state succeeded with zero current fetch failures. */
export function identityAnswered(state: { status: string; fetchFailureCount: number } | undefined): boolean {
  return state?.status === "success" && state.fetchFailureCount === 0
}

/** Returns the cached `/me` response only when its most recent fetch succeeded. */
export function cachedIdentity(queryClient: QueryClient): CurrentUserResponse | undefined {
  const state = queryClient.getQueryState<CurrentUserResponse>(currentUserQueryKey())
  return identityAnswered(state) ? state?.data : undefined
}

/** Returns capabilities for the currently cached `/me` identity. */
export function cachedCapabilities(queryClient: QueryClient): Capabilities {
  return capabilitiesOf(cachedIdentity(queryClient))
}

/** Returns the booking writer email for the currently cached `/me` identity, or `null`. */
export function cachedWriter(queryClient: QueryClient): string | null {
  return writerOf(cachedIdentity(queryClient))
}

/** Returns the writer email for `kind` from the currently cached `/me` identity, or `null`. */
export function cachedWriterFor(kind: WriteKind, queryClient: QueryClient): string | null {
  return writerFor(kind, cachedIdentity(queryClient))
}

/** Returns the `identityKey` for the currently cached `/me` identity, or `"failed"` if unavailable. */
export function cachedIdentityKey(queryClient: QueryClient): string {
  const user = cachedIdentity(queryClient)
  return user ? identityKey(user) : "failed"
}
