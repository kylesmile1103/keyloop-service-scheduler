import type { CurrentUserResponse } from "@/api/types.gen"

/**
 * `GET /api/v1/me` as the API answers it for each kind of caller (ADR-027): anonymous (also an expired or invalid
 * session), a verified account without a role, and one per API role. The URLs are the API's own: the login path with
 * `/` as its return target, and the hostname's Access logout.
 */
const urls = { loginUrl: "/auth/login?returnTo=%2F", logoutUrl: "/cdn-cgi/access/logout" }

export const anonymous: CurrentUserResponse = { authenticated: false, email: null, displayName: null, roles: [], ...urls }

export const noRole: CurrentUserResponse = {
  authenticated: true,
  email: "visitor@example.com",
  displayName: "Robin Visitor",
  roles: [],
  ...urls,
}

export const viewer: CurrentUserResponse = {
  authenticated: true,
  email: "viewer@keyloop.test",
  displayName: "Vera Viewer",
  roles: ["Viewer"],
  ...urls,
}

export const serviceAdvisor: CurrentUserResponse = {
  authenticated: true,
  email: "advisor@keyloop.test",
  displayName: "Sam Advisor",
  roles: ["ServiceAdvisor"],
  ...urls,
}

export const admin: CurrentUserResponse = {
  authenticated: true,
  email: "admin@keyloop.test",
  displayName: "Development user",
  roles: ["Admin"],
  ...urls,
}

/** A verified token without a name claim: the API answers `displayName: null`. */
export const unnamedAdvisor: CurrentUserResponse = { ...serviceAdvisor, displayName: null }

/** Each caller by the name the tests use. */
export const identities = { anonymous, noRole, viewer, serviceAdvisor, admin } as const
