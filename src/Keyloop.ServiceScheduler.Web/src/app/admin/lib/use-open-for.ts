import { useState } from "react"

/** Binds open sheet/dialog state to the active Admin identity and discards it if the signed-in user changes. */
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
