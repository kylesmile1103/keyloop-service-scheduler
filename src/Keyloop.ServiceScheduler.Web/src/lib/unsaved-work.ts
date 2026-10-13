/** In-memory registry of active unsaved-work claims for the current tab. */
const claims = new Set<symbol>()

/** Registers an unsaved-work claim until the returned release function is called. */
export function holdUnsavedWork(): () => void {
  const claim = Symbol("unsaved work")
  claims.add(claim)
  return () => {
    claims.delete(claim)
  }
}

/** Returns true when any view currently holds an unsaved-work claim. */
export function hasUnsavedWork(): boolean {
  return claims.size > 0
}
