import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"

import { useQueryFailure } from "@/hooks/use-query-failure"

// A query without data loses its error whenever it fetches again (TanStack Query 5); the hook keeps it for its view.

/** A read that answers when the test says: `fail(error)` or `succeed(data)`. */
function controlledRead() {
  let settle: { fail: (error: Error) => void; succeed: (data: string) => void } = { fail: () => {}, succeed: () => {} }
  const read = () =>
    new Promise<string>((resolve, reject) => {
      settle = { fail: reject, succeed: resolve }
    })
  return { read, fail: (error: Error) => settle.fail(error), succeed: (data: string) => settle.succeed(data) }
}

function renderFailure(read: () => Promise<string>, initialKey = "tuesday") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  const rendered = renderHook(
    ({ day }: { day: string }) => {
      const query = useQuery({ queryKey: ["schedule", day], queryFn: read })
      return { query, failure: useQueryFailure(query, ["schedule", day]) }
    },
    { wrapper, initialProps: { day: initialKey } }
  )
  return { ...rendered, queryClient }
}

describe("useQueryFailure", () => {
  it("keeps a failure while the same query is read again, until data arrives", async () => {
    const api = controlledRead()
    const { result } = renderFailure(api.read)
    const first = new Error("first")
    await act(async () => api.fail(first))
    await waitFor(() => expect(result.current.failure).toBe(first))

    act(() => void result.current.query.refetch())

    await waitFor(() => expect(result.current.query.isFetching).toBe(true))
    expect(result.current.query.isError).toBe(false)
    expect(result.current.failure).toBe(first)

    await act(async () => api.succeed("the day"))
    await waitFor(() => expect(result.current.query.data).toBe("the day"))
    expect(result.current.failure).toBeNull()
  })

  it("shows the next failure in place of the kept one", async () => {
    const api = controlledRead()
    const { result } = renderFailure(api.read)
    await act(async () => api.fail(new Error("first")))
    await waitFor(() => expect(result.current.failure).not.toBeNull())

    act(() => void result.current.query.refetch())
    await waitFor(() => expect(result.current.query.isFetching).toBe(true))
    const second = new Error("second")
    await act(async () => api.fail(second))

    await waitFor(() => expect(result.current.failure).toBe(second))
  })

  it("never shows a failure while another query loads", async () => {
    const api = controlledRead()
    const { result, rerender } = renderFailure(api.read)
    await act(async () => api.fail(new Error("tuesday")))
    await waitFor(() => expect(result.current.failure).not.toBeNull())

    rerender({ day: "wednesday" })

    expect(result.current.query.isFetching).toBe(true)
    expect(result.current.failure).toBeNull()
  })

  it("forgets a failure once a read succeeds, so a later reload of that query shows loading", async () => {
    const api = controlledRead()
    const { result, queryClient } = renderFailure(api.read)
    await act(async () => api.fail(new Error("first")))
    await waitFor(() => expect(result.current.failure).not.toBeNull())
    act(() => void result.current.query.refetch())
    await act(async () => api.succeed("the day"))
    await waitFor(() => expect(result.current.query.data).toBe("the day"))

    act(() => void queryClient.resetQueries({ queryKey: ["schedule"] }))

    await waitFor(() => expect(result.current.query.isFetching).toBe(true))
    expect(result.current.query.data).toBeUndefined()
    expect(result.current.failure).toBeNull()
  })
})
