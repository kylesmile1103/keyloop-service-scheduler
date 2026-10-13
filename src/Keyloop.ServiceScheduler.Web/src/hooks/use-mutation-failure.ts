import { useState } from "react"

interface MutationState<TError> {
  error: TError | null
  isPending: boolean
}

/**
 * Retains `mutation.error` across retries while `mutation.isPending` is true so error alerts
 * and their focused retry controls remain mounted until the retry settles or is reset.
 */
export function useMutationFailure<TError>(mutation: MutationState<TError>): TError | null {
  const [kept, setKept] = useState<TError | null>(null)

  const latest = mutation.error !== null ? mutation.error : mutation.isPending ? kept : null
  if (latest !== kept) setKept(latest)

  return latest
}
