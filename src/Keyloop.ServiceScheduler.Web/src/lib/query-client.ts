import { QueryClient } from "@tanstack/react-query"

/**
 * TanStack Query defaults for the dispatch board.
 * - Reads stay fresh for 2 s, so components that mount together share one request, and a failed read is retried once.
 * - Mutations are never retried by the client: a booking must not be submitted twice behind the user's back. Retrying a
 *   booking is the user's decision (the API's Idempotency-Key makes a deliberate retry safe).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 2000, retry: 1 },
      mutations: { retry: 0 },
    },
  })
}

export const queryClient = createQueryClient()
