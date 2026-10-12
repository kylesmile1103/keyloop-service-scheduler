/**
 * The signed-in session's seams. Authentication is designed but deferred (ARCHITECTURE §11.3, ADR-010): the API runs in
 * anonymous mode, so there is nowhere to sign in. Task 27b answers these from `GET /api/v1/me` and the Access login URL.
 */

/** Where the Sign in action goes; `null` while sign-in is not enabled in this environment. */
export function signInUrl(): string | null {
  return null
}
