import { hashKey, type QueryKey, type UseQueryResult } from "@tanstack/react-query"
import { useState } from "react"

interface KeptFailure<TError> {
  queryHash: string
  error: TError
}

/**
 * Retains `query.error` for the same `queryKey` while a failed query refetches without data,
 * keeping error states and focused retry controls mounted until data or a new error arrives.
 */
export function useQueryFailure<TError>(query: UseQueryResult<unknown, TError>, queryKey: QueryKey): TError | null {
  const queryHash = hashKey(queryKey)
  const [kept, setKept] = useState<KeptFailure<TError> | null>(null)

  const latest =
    query.error !== null
      ? { queryHash, error: query.error }
      : query.data === undefined && kept?.queryHash === queryHash
        ? kept
        : null
  if (latest?.error !== kept?.error || latest?.queryHash !== kept?.queryHash) setKept(latest)

  return latest?.error ?? null
}
