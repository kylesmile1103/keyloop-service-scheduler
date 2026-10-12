/**
 * The signed-in session's seams. The API already authenticates every request (Cloudflare Access, ADR-027) and applies its
 * roles, but the app does not offer sign-in yet: Task 27b answers these from `GET /api/v1/me` and its Access login URL.
 */

/** Where the Sign in action goes; `null` while sign-in is not enabled in this environment. */
export function signInUrl(): string | null {
  return null
}
