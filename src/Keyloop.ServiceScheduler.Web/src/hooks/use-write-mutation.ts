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
import { cachedWriterFor, type WriteKind } from "@/lib/session"
import { type BoundWrite, bindWrite, CallerChangedError, WriteNotAllowedError } from "@/lib/session-cache"

/** Request-level account guards passed to a write's `mutationFn`. */
export type WriteSend = Pick<BoundWrite, "fetch" | "guard">

export interface WriteMutationOptions<TData, TError, TVariables extends object, TOnMutateResult>
  extends Omit<UseMutationOptions<TData, TError, TVariables, TOnMutateResult>, "mutationFn"> {
  /** Executes the write using `write.fetch` for requests and `write.guard()` after async steps. */
  mutationFn: (variables: TVariables, write: WriteSend, context: MutationFunctionContext) => Promise<TData>
  /** Called when a response is discarded because the signed-in caller changed while the write was in flight. */
  onDiscarded?: (variables: TVariables) => void
  /** Permission scope: `"bookings"` (default, `CurrentUser.writer`) or `"admin"` (`CurrentUser.adminWriter`). */
  writes?: WriteKind
}

export type SendWrite<TVariables> = (variables: TVariables) => boolean

export interface WriteMutationResult<TData, TError, TVariables, TOnMutateResult>
  extends Omit<UseMutationResult<TData, TError, TVariables, TOnMutateResult>, "mutate" | "mutateAsync"> {
  /**
   * Binds a write to the writer the view was rendered for, returning a sender that verifies the view is still mounted
   * and the cached writer has not changed before dispatching (`null` if no longer authorised).
   */
  begin: () => SendWrite<TVariables> | null
  /** Immediately begins and dispatches the write; returns `true` if sent. */
  mutate: SendWrite<TVariables>
}

/**
 * Wraps `useMutation` to bind role-protected writes to the account the view was rendered for.
 * Aborts requests before dispatch if the cached writer changes, and discards responses if the caller changes in flight.
 */
export function useWriteMutation<TData = unknown, TError = DefaultError, TVariables extends object = object, TOnMutateResult = unknown>(
  options: WriteMutationOptions<TData, TError, TVariables, TOnMutateResult>
): WriteMutationResult<TData, TError, TVariables, TOnMutateResult> {
  const queryClient = useQueryClient()
  const current = useCurrentUser()
  const { mutationFn, onSuccess, onError, onSettled, onDiscarded, writes = "bookings", ...rest } = options
  const writer = writes === "admin" ? current.adminWriter : current.writer
  const boundTo = useRef(new WeakMap<object, string>())
  const sends = useRef(new WeakMap<object, BoundWrite>())
  const drawnFor = useRef<string | null>(null)
  const mounted = useRef(false)
  const holding = useRef<TVariables | null>(null)
  const resetObserver = useRef<() => void>(() => {})

  const stale = (variables: TVariables) => sends.current.get(variables)?.stale() ?? true
  const ours = (error: unknown) => error instanceof CallerChangedError || error instanceof WriteNotAllowedError
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
      const write = bindWrite(queryClient, boundTo.current.get(variables) ?? null, writes)
      sends.current.set(variables, write)
      write.guard()
      let data: TData
      try {
        data = await mutationFn(variables, { fetch: write.fetch, guard: write.guard }, context)
      } catch (error) {
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

  const mayStill = (owner: string | null) =>
    owner !== null && mounted.current && drawnFor.current === owner && cachedWriterFor(writes, queryClient) === owner

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

  return { ...result, begin, mutate: (variables) => begin()?.(variables) ?? false }
}
