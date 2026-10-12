import {
  type DefaultError,
  type MutationFunctionContext,
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query"
import { useLayoutEffect, useRef } from "react"

import { useCurrentUser } from "@/hooks/use-current-user"
import { cachedWriter } from "@/lib/session"
import { type BoundWrite, bindWrite, CallerChangedError, WriteNotAllowedError } from "@/lib/session-cache"

/** What a write's `mutationFn` is given to send with: the account check for each request, and for each step awaited. */
export type WriteSend = Pick<BoundWrite, "fetch" | "guard">

export interface WriteMutationOptions<TData, TError, TVariables extends object, TOnMutateResult>
  extends Omit<UseMutationOptions<TData, TError, TVariables, TOnMutateResult>, "mutationFn"> {
  /**
   * Sends the write. Every request it makes must be given `write.fetch(...)` as its `fetch` option (wrapping a span's
   * traced fetch, if any): the account is checked there, as the generated client hands it the request, immediately before
   * it leaves. Call `write.guard()` after each step awaited (reading a photo, an upload) before using what it answered:
   * it throws when the caller changed or is no longer the account the write is bound to (`bindWrite`).
   */
  mutationFn: (variables: TVariables, write: WriteSend, context: MutationFunctionContext) => Promise<TData>
  /** An answer thrown away because who is signed in changed while the write ran (the view may say so). */
  onDiscarded?: (variables: TVariables) => void
}

/** Sends one write now, if it may still be sent: whether it was. */
export type SendWrite<TVariables> = (variables: TVariables) => boolean

export interface WriteMutationResult<TData, TError, TVariables, TOnMutateResult>
  extends Omit<UseMutationResult<TData, TError, TVariables, TOnMutateResult>, "mutate" | "mutateAsync"> {
  /**
   * Starts a write that is sent later, once a form's checks have passed: it is bound now to the account the view was
   * drawn for, and `null` unless the identity in the cache is that account (so a press that comes after `/me` named
   * another caller, even one that may write, starts nothing). The function it returns sends the write only if, by then,
   * the view is still there (a discarded booking's view is not) and the cache still names that account; else it sends
   * nothing and returns false.
   */
  begin: () => SendWrite<TVariables> | null
  /** `begin` and its send at once, for a write with no checks to wait for: whether it was sent. */
  mutate: SendWrite<TVariables>
}

/**
 * `useMutation` for a write the API reserves for a role (book, cancel, ask for suggestions and upload their photos), bound
 * to the account it was made for (ARCHITECTURE §15):
 * - a write belongs to the writer the view was drawn for (`CurrentUser.writer`: the email of an account that may write).
 *   It is sent only while the identity in the cache is that account: checked when it is started (`begin`, `mutate`), again
 *   when it is sent (after a form's checks, and only while its view is still mounted), as its `mutationFn` starts, after
 *   each step awaited (`write.guard`), and last inside the fetch the generated client calls for each request
 *   (`write.fetch`), after the client's own awaited preparation and interceptors and immediately before the request is
 *   forwarded. A press can come after `/me` changed but before the view has drawn it, so the cache decides, not the last
 *   render; two roles that may write for the same email are the same writer, and a write's requests all leave as one
 *   caller (`bindWrite`);
 * - a write stopped before its request left keeps nothing: its mutation is removed from the cache and this hook goes back
 *   to idle at once, whatever it has rendered, so no mutation state holds its variables;
 * - an answer, success or failure, that arrives once the identity has changed since the write's first request left
 *   (`callerGeneration`, which every change of caller advances, the same email's included) is thrown away: it is not
 *   returned (so nothing caches it), `onSuccess`, `onError` and `onSettled` do not run (no toast, no closing, no field
 *   errors for the next caller), its mutation is removed and this hook goes back to idle; `onDiscarded` says so.
 * A request that left before the change is not recalled: the API answers it as the account that sent it.
 */
export function useWriteMutation<TData = unknown, TError = DefaultError, TVariables extends object = object, TOnMutateResult = unknown>(
  options: WriteMutationOptions<TData, TError, TVariables, TOnMutateResult>
): WriteMutationResult<TData, TError, TVariables, TOnMutateResult> {
  const queryClient = useQueryClient()
  const { writer } = useCurrentUser()
  const { mutationFn, onSuccess, onError, onSettled, onDiscarded, ...rest } = options
  // The account each write was sent for, and the send bound to it (which caller its requests left as), by its variables
  // (one object per send).
  const boundTo = useRef(new WeakMap<object, string>())
  const sends = useRef(new WeakMap<object, BoundWrite>())
  // The writer this view was last drawn for, whether it is still mounted, and the write its observer holds now.
  const drawnFor = useRef<string | null>(null)
  const mounted = useRef(false)
  const holding = useRef<TVariables | null>(null)
  const resetObserver = useRef<() => void>(() => {})

  const stale = (variables: TVariables) => sends.current.get(variables)?.stale() ?? true
  const ours = (error: unknown) => error instanceof CallerChangedError || error instanceof WriteNotAllowedError
  // Nothing of a write that was stopped or thrown away stays: its mutation leaves the cache, and the hook goes back to idle
  // if it still holds it (it may have moved on to a newer one). Decided by the send, not by what the hook has rendered.
  const forget = (variables: TVariables) => {
    if (holding.current === variables) {
      holding.current = null
      resetObserver.current()
    }
    const mutations = queryClient.getMutationCache()
    for (const mutation of mutations.getAll()) if (mutation.state.variables === variables) mutations.remove(mutation)
  }

  const result = useMutation<TData, TError, TVariables, TOnMutateResult>({
    ...rest,
    mutationFn: async (variables, context) => {
      const write = bindWrite(queryClient, boundTo.current.get(variables) ?? null)
      sends.current.set(variables, write)
      write.guard()
      let data: TData
      try {
        data = await mutationFn(variables, { fetch: write.fetch, guard: write.guard }, context)
      } catch (error) {
        // Stopped before its next request left (by its fetch, or a guard): there is no answer to throw away.
        if (error instanceof WriteNotAllowedError) throw error
        throw write.stale() ? new CallerChangedError() : error
      }
      if (write.stale()) throw new CallerChangedError()
      return data
    },
    onSuccess: (data, variables, onMutateResult, context) => {
      if (stale(variables)) {
        forget(variables)
        onDiscarded?.(variables)
        return
      }
      return onSuccess?.(data, variables, onMutateResult, context)
    },
    onError: (error, variables, onMutateResult, context) => {
      if (ours(error) || stale(variables)) {
        forget(variables)
        if (!(error instanceof WriteNotAllowedError)) onDiscarded?.(variables)
        return
      }
      return onError?.(error, variables, onMutateResult, context)
    },
    onSettled: (data, error, variables, onMutateResult, context) => {
      if (ours(error) || stale(variables)) return
      return onSettled?.(data, error, variables, onMutateResult, context)
    },
  })
  const { mutate: send, reset } = result
  useLayoutEffect(() => {
    drawnFor.current = writer
    resetObserver.current = reset
  })
  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Whether a write bound to `owner` may still be sent: its view is mounted and drawn for that account, and the identity
  // in the cache is that account.
  const mayStill = (owner: string | null) =>
    owner !== null && mounted.current && drawnFor.current === owner && cachedWriter(queryClient) === owner

  const begin = (): SendWrite<TVariables> | null => {
    const owner = drawnFor.current
    if (!mayStill(owner)) return null
    return (variables) => {
      if (!mayStill(owner)) return false
      boundTo.current.set(variables, owner!)
      holding.current = variables
      send(variables)
      return true
    }
  }

  // TanStack's own `mutate` and `mutateAsync` are not offered: every send goes through `begin`.
  return { ...result, begin, mutate: (variables) => begin()?.(variables) ?? false }
}
