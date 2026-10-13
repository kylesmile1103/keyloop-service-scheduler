import { useState } from "react"

/**
 * Something opened in the Resources area (an edit sheet, a deactivation, a policy draft) for the Admin it was opened by
 * (Task 30b, ARCHITECTURE §15): `owner` is that Admin (`CurrentUser.adminWriter`), as a booking being entered belongs to its
 * writer. When it changes (another Admin, or a role that cannot edit) the open thing closes without saving in the same
 * render, never painting for the next caller, and `discarded` says so for a note; the same Admin gaining or losing another
 * role keeps it, as the same writer keeps a booking.
 */
export function useOpenFor<T>(identity: string) {
  const [state, setState] = useState<{ value: T; identity: string; open: boolean } | null>(null)
  const [discarded, setDiscarded] = useState(false)
  // Adjusted while rendering (React's pattern for state that follows a prop): dropped in the render the change arrives in.
  if (state && state.identity !== identity) {
    setState(null)
    if (state.open) setDiscarded(true)
  }
  const current = state?.identity === identity ? state : null
  return {
    /** What is open, kept while it animates closed; `null` once nothing is. */
    value: current?.value ?? null,
    isOpen: current?.open ?? false,
    open: (value: T) => {
      setDiscarded(false)
      setState({ value, identity, open: true })
    },
    close: () => setState((previous) => (previous ? { ...previous, open: false } : previous)),
    /** An open one was closed by a change of who is signed in, and nothing has been opened since. */
    discarded,
  }
}
