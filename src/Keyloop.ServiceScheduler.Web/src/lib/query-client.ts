import { QueryClient } from "@tanstack/react-query"

/** Creates a `QueryClient` with a 2s stale time, single read retry, and no automatic mutation retries. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 2000, retry: 1 },
      mutations: { retry: 0 },
    },
  })
}

export const queryClient = createQueryClient()
