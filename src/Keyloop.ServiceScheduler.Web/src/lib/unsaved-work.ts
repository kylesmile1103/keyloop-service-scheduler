/**
 * Work on screen that a full-page navigation would lose: a booking being entered, an Admin's edit sheet or rule dialog, an
 * unpublished policy draft, a cancellation reason typed. A view holds a claim while it has some (`useUnsavedWork`), and the
 * session renewal (lib/session-renewal.ts) asks before it navigates: with a claim held it offers *Stay signed in* instead of
 * renewing on its own. Kept in memory for this tab only; it decides nothing else.
 */
const claims = new Set<symbol>()

/** Holds a claim on unsaved work until the returned release is called (calling it again does nothing). */
export function holdUnsavedWork(): () => void {
  const claim = Symbol("unsaved work")
  claims.add(claim)
  return () => {
    claims.delete(claim)
  }
}

/** Whether any view holds unsaved work at this moment. */
export function hasUnsavedWork(): boolean {
  return claims.size > 0
}
