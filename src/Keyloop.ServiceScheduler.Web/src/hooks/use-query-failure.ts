import { hashKey, type QueryKey, type UseQueryResult } from "@tanstack/react-query"
import { useState } from "react"

interface KeptFailure<TError> {
  queryHash: string
  error: TError
}

/**
 * A query's failure, as `query.error`, except that it is kept while the same query is read again (a Try again, a window
 * focus or auto refresh, a wait for the network) until data or the next failure arrives. `null` when the last read
 * succeeded, and while a query that has not failed loads.
 *
 * TanStack Query 5 puts a query without data back to `pending`, with no error, whenever it fetches again (one with data
 * keeps its error). A view that shows the failure only while `isError` swaps it for the loading state on every retry,
 * and the focused Try again goes with it: focus falls to the page (in a dialog, to the dialog itself). Kept, the failure
 * and its Try again stay, the button unavailable but focused (Base UI's `focusableWhenDisabled`), until the answer
 * arrives. `queryKey` names the query, so a failure never shows while another query (the next day, another dealership)
 * loads.
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
  // Kept as it arrives, adjusted while rendering (React's pattern for state that follows a prop); dropped once a read
  // succeeds, or when the query is another one.
  if (latest?.error !== kept?.error || latest?.queryHash !== kept?.queryHash) setKept(latest)

  return latest?.error ?? null
}
