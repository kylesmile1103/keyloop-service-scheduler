import { useState } from "react"

/** What the hook reads of a `useMutation` result. */
interface MutationState<TError> {
  error: TError | null
  isPending: boolean
}

/**
 * A mutation's failure, as `mutation.error`, except that it is kept while the mutation runs again (a Try again, a
 * suggested slot, another press of the form's button) until the answer: `null` once it succeeds or is reset, the next
 * failure if it fails again. The mutation counterpart of `useQueryFailure`.
 *
 * TanStack Query 5 clears a mutation's error as soon as it runs again (`pending`, no error). A view that shows the
 * failure only while `isError` removes it on every retry, and the focused Try again or slot chip inside it goes with it:
 * focus falls to the page (in a dialog, to the dialog itself), and the control's own busy state never shows. Kept, the
 * failure and its controls stay, unavailable but focused (Base UI's `focusableWhenDisabled`), until the answer arrives.
 */
export function useMutationFailure<TError>(mutation: MutationState<TError>): TError | null {
  const [kept, setKept] = useState<TError | null>(null)

  const latest = mutation.error !== null ? mutation.error : mutation.isPending ? kept : null
  // Kept as it arrives, adjusted while rendering (React's pattern for state that follows a prop); dropped on a success
  // or a reset, which leave the mutation without an error and not pending.
  if (latest !== kept) setKept(latest)

  return latest
}
