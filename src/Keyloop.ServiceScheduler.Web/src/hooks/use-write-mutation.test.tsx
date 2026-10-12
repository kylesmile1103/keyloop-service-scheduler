import { QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

import type { CurrentUserResponse } from "@/api/types.gen"
import { useWriteMutation } from "@/hooks/use-write-mutation"
import { createQueryClient } from "@/lib/query-client"
import { currentUserQueryKey } from "@/lib/session"
import { admin, anonymous, viewer } from "@/test/identities"

// A write is bound to the account its view was drawn for (Task 27b, review round 2): it is sent only while the identity in
// the cache is still that account, whatever React has drawn yet, and a write stopped before its request leaves nothing
// behind, in the mutation cache or in the hook. No SessionWatch here, so the caller generation never moves: these cases
// are decided by the binding alone.

const otherAdmin: CurrentUserResponse = { ...admin, email: "another.admin@keyloop.test", displayName: "Another Admin" }
const sameEmailAdvisor: CurrentUserResponse = { ...admin, roles: ["ServiceAdvisor"] }

/** What a write carries: a customer's details, as a booking's would. */
const draft = () => ({ customer: { email: "draft.private@example.invalid" } })

function renderWrite(drawnFor: CurrentUserResponse = admin) {
  const queryClient = createQueryClient()
  queryClient.setQueryData(currentUserQueryKey(), drawnFor)
  const send = vi.fn(async (variables: ReturnType<typeof draft>) => ({ sent: variables.customer.email }))
  const onError = vi.fn()
  const onDiscarded = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  const hook = renderHook(() => useWriteMutation({ mutationFn: (variables: ReturnType<typeof draft>) => send(variables), onError, onDiscarded }), {
    wrapper,
  })
  const becomes = (user: CurrentUserResponse) => queryClient.setQueryData(currentUserQueryKey(), user)
  return { ...hook, queryClient, send, onError, onDiscarded, becomes }
}

/** Nothing of the write anywhere: no mutation in the cache, nothing running, and the hook idle without its variables. */
async function expectNothingKept(rendered: Pick<ReturnType<typeof renderWrite>, "queryClient"> & { result: { current: { isIdle: boolean; variables: unknown } } }) {
  await waitFor(() => expect(rendered.result.current.isIdle).toBe(true))
  expect(rendered.result.current.variables).toBeUndefined()
  expect(rendered.queryClient.getMutationCache().getAll()).toHaveLength(0)
  expect(rendered.queryClient.isMutating()).toBe(0)
}

describe("useWriteMutation", () => {
  it.each<[string, CurrentUserResponse]>([
    ["signed out", anonymous],
    ["a Viewer", viewer],
    ["another account that may write", otherAdmin],
  ])("sends nothing and keeps nothing once the identity in the cache is %s, before the hook has drawn it", async (_, next) => {
    const rendered = renderWrite()

    act(() => {
      rendered.becomes(next)
      rendered.result.current.mutate(draft())
    })

    await expectNothingKept(rendered)
    expect(rendered.send).not.toHaveBeenCalled()
    expect(rendered.onError).not.toHaveBeenCalled()
    expect(rendered.onDiscarded).not.toHaveBeenCalled()
  })

  it.each<[string, CurrentUserResponse]>([
    ["signs out", anonymous],
    ["is another account that may write", otherAdmin],
  ])("stops a write whose caller %s after it was asked for and before its request, and keeps nothing of it", async (_, next) => {
    const rendered = renderWrite()

    // TanStack starts the request a few microtasks after `mutate`: the identity changes in between.
    act(() => {
      rendered.result.current.mutate(draft())
      rendered.becomes(next)
    })

    await waitFor(() => expect(rendered.queryClient.isMutating()).toBe(0))
    await expectNothingKept(rendered)
    expect(rendered.send).not.toHaveBeenCalled()
    expect(rendered.onError).not.toHaveBeenCalled()
  })

  it("sends nothing from a view drawn for nobody until it has been drawn for the writer the cache now names", async () => {
    const rendered = renderWrite(anonymous)

    act(() => {
      rendered.becomes(admin)
      rendered.result.current.mutate(draft())
    })
    expect(rendered.send).not.toHaveBeenCalled()
    expect(rendered.queryClient.getMutationCache().getAll()).toHaveLength(0)

    // Drawn for the Admin now: a press on that view is the Admin's.
    await waitFor(() => expect(rendered.result.current.begin()).not.toBeNull())
    act(() => void rendered.result.current.mutate(draft()))
    await waitFor(() => expect(rendered.result.current.isSuccess).toBe(true))
    expect(rendered.send).toHaveBeenCalledTimes(1)
  })

  it("sends a write when the same email changes to another role that may write", async () => {
    const rendered = renderWrite()

    act(() => {
      rendered.becomes(sameEmailAdvisor)
      rendered.result.current.mutate(draft())
    })

    await waitFor(() => expect(rendered.result.current.isSuccess).toBe(true))
    expect(rendered.send).toHaveBeenCalledTimes(1)
  })

  describe("the account checked last, inside the fetch each request is given", () => {
    /**
     * A write whose request is prepared over a few awaits (as the generated client prepares one) and then handed to the
     * fetch the hook gives it; the identity changes during that preparation.
     */
    function renderPreparedWrite() {
      const queryClient = createQueryClient()
      queryClient.setQueryData(currentUserQueryKey(), admin)
      const base = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ sent: true })))
      let prepare!: () => void
      const prepared = new Promise<void>((resolve) => (prepare = resolve))
      const onError = vi.fn()
      const onSuccess = vi.fn()
      const onDiscarded = vi.fn()
      const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      const hook = renderHook(
        () =>
          useWriteMutation({
            mutationFn: async (variables: ReturnType<typeof draft>, write) => {
              await prepared
              const response = await write.fetch(base)("http://localhost:3000/api/v1/writes", {
                method: "POST",
                body: JSON.stringify(variables),
              })
              return response.json()
            },
            onError,
            onSuccess,
            onDiscarded,
          }),
        { wrapper }
      )
      const becomes = (user: CurrentUserResponse) => queryClient.setQueryData(currentUserQueryKey(), user)
      return { ...hook, queryClient, base, prepare: () => act(prepare), onError, onSuccess, onDiscarded, becomes }
    }

    it.each<[string, CurrentUserResponse]>([
      ["signs out", anonymous],
      ["becomes a Viewer", viewer],
      ["is another account that may write", otherAdmin],
    ])("sends nothing and keeps nothing when the caller %s while the request is prepared", async (_, next) => {
      const rendered = renderPreparedWrite()
      act(() => void rendered.result.current.mutate(draft()))

      rendered.becomes(next)
      await rendered.prepare()

      await expectNothingKept(rendered)
      expect(rendered.base).not.toHaveBeenCalled()
      expect(rendered.onError).not.toHaveBeenCalled()
      expect(rendered.onSuccess).not.toHaveBeenCalled()
      expect(rendered.onDiscarded).not.toHaveBeenCalled()
    })

    it("sends, and uses the answer, when the same email changes to another role that may write while the request is prepared", async () => {
      const rendered = renderPreparedWrite()
      act(() => void rendered.result.current.mutate(draft()))

      rendered.becomes(sameEmailAdvisor)
      await rendered.prepare()

      await waitFor(() => expect(rendered.result.current.isSuccess).toBe(true))
      expect(rendered.base).toHaveBeenCalledOnce()
      expect(rendered.onSuccess).toHaveBeenCalledOnce()
    })
  })

  describe("begin, for a write sent once a form's checks have passed", () => {
    it("binds before the checks and sends when they pass, the caller unchanged", async () => {
      const rendered = renderWrite()

      const send = rendered.result.current.begin()
      expect(send).not.toBeNull()
      act(() => void send!(draft()))

      await waitFor(() => expect(rendered.result.current.isSuccess).toBe(true))
      expect(rendered.send).toHaveBeenCalledTimes(1)
    })

    it("returns nothing to send with once the identity in the cache is another account, before the hook has drawn it", () => {
      const rendered = renderWrite()

      rendered.becomes(otherAdmin)

      expect(rendered.result.current.begin()).toBeNull()
    })

    it.each<[string, CurrentUserResponse]>([
      ["signs out", anonymous],
      ["is another account that may write", otherAdmin],
    ])("sends nothing when the caller %s while the checks run", async (_, next) => {
      const rendered = renderWrite()
      const send = rendered.result.current.begin()!

      rendered.becomes(next)
      let sent = true
      act(() => {
        sent = send(draft())
      })

      expect(sent).toBe(false)
      await expectNothingKept(rendered)
      expect(rendered.send).not.toHaveBeenCalled()
    })

    it("sends nothing once the view that began it is gone (a discarded booking), whoever is signed in by then", async () => {
      const rendered = renderWrite()
      const send = rendered.result.current.begin()!

      rendered.unmount()
      let sent = true
      act(() => {
        sent = send(draft())
      })

      expect(sent).toBe(false)
      expect(rendered.queryClient.getMutationCache().getAll()).toHaveLength(0)
      expect(rendered.send).not.toHaveBeenCalled()
    })

    it("sends nothing once the view has been drawn for another account meanwhile, even when the cache names the first again", async () => {
      const rendered = renderWrite()
      const send = rendered.result.current.begin()!

      rendered.becomes(otherAdmin)
      await waitFor(() => expect(rendered.result.current.begin()).not.toBeNull())
      rendered.becomes(admin)
      let sent = true
      act(() => {
        sent = send(draft())
      })

      expect(sent).toBe(false)
      expect(rendered.send).not.toHaveBeenCalled()
      expect(rendered.queryClient.getMutationCache().getAll()).toHaveLength(0)
    })

    it("still sends when the same email changes to another role that may write while the checks run", async () => {
      const rendered = renderWrite()
      const send = rendered.result.current.begin()!

      rendered.becomes(sameEmailAdvisor)
      act(() => void send(draft()))

      await waitFor(() => expect(rendered.result.current.isSuccess).toBe(true))
      expect(rendered.send).toHaveBeenCalledTimes(1)
    })
  })
})
