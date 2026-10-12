import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"

import { useMutationFailure } from "@/hooks/use-mutation-failure"

// A mutation loses its error as soon as it runs again (TanStack Query 5); the hook keeps it for its view until the answer.

/** A save that answers when the test says: `fail(error)` or `succeed(data)`. */
function controlledSave() {
  let settle: { fail: (error: Error) => void; succeed: (data: string) => void } = { fail: () => {}, succeed: () => {} }
  const save = () =>
    new Promise<string>((resolve, reject) => {
      settle = { fail: reject, succeed: resolve }
    })
  return { save, fail: (error: Error) => settle.fail(error), succeed: (data: string) => settle.succeed(data) }
}

function renderFailure(save: () => Promise<string>) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  return renderHook(
    () => {
      const mutation = useMutation({ mutationFn: save })
      return { mutation, failure: useMutationFailure(mutation) }
    },
    { wrapper }
  )
}

/** Runs the mutation and waits until it is out. */
async function send(result: { current: { mutation: { mutate: () => void; isPending: boolean } } }) {
  act(() => result.current.mutation.mutate())
  await waitFor(() => expect(result.current.mutation.isPending).toBe(true))
}

describe("useMutationFailure", () => {
  it("has nothing to show before the first answer", async () => {
    const api = controlledSave()
    const { result } = renderFailure(api.save)
    expect(result.current.failure).toBeNull()

    await send(result)

    expect(result.current.failure).toBeNull()
  })

  it("keeps a failure while the mutation runs again, until it succeeds", async () => {
    const api = controlledSave()
    const { result } = renderFailure(api.save)
    await send(result)
    const first = new Error("first")
    await act(async () => api.fail(first))
    await waitFor(() => expect(result.current.failure).toBe(first))

    await send(result)

    expect(result.current.mutation.isError).toBe(false)
    expect(result.current.mutation.error).toBeNull()
    expect(result.current.failure).toBe(first)

    await act(async () => api.succeed("booked"))
    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true))
    expect(result.current.failure).toBeNull()
  })

  it("shows the next failure in place of the kept one", async () => {
    const api = controlledSave()
    const { result } = renderFailure(api.save)
    await send(result)
    await act(async () => api.fail(new Error("first")))
    await waitFor(() => expect(result.current.failure).not.toBeNull())

    await send(result)
    const second = new Error("second")
    await act(async () => api.fail(second))

    await waitFor(() => expect(result.current.failure).toBe(second))
  })

  it("forgets a failure when the mutation is reset, so the next run shows no failure while it is out", async () => {
    const api = controlledSave()
    const { result } = renderFailure(api.save)
    await send(result)
    await act(async () => api.fail(new Error("first")))
    await waitFor(() => expect(result.current.failure).not.toBeNull())

    act(() => result.current.mutation.reset())

    await waitFor(() => expect(result.current.mutation.isIdle).toBe(true))
    expect(result.current.failure).toBeNull()
    await send(result)
    expect(result.current.failure).toBeNull()
  })
})
