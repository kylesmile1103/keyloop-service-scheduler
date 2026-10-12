import {
  type DefaultError,
  type MutationFunctionContext,
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect, useRef } from "react"

import { CallerChangedError, callerGeneration, WriteNotAllowedError, writeGuard } from "@/lib/session-cache"

export interface WriteMutationOptions<TData, TError, TVariables extends object, TOnMutateResult>
  extends Omit<UseMutationOptions<TData, TError, TVariables, TOnMutateResult>, "mutationFn"> {
  /**
   * Sends the write. `guard` has already passed once; call it again after each step awaited (reading a photo, an upload)
   * before the next request: it throws when the caller changed or may not write (`writeGuard`).
   */
  mutationFn: (variables: TVariables, guard: () => void, context: MutationFunctionContext) => Promise<TData>
  /** An answer thrown away because who is signed in changed while the write ran (the view may say so). */
  onDiscarded?: (variables: TVariables) => void
}

/**
 * `useMutation` for a write the API reserves for a role (book, cancel, ask for suggestions), scoped to the caller who sent
 * it (ARCHITECTURE §15):
 * - it is checked as it is sent, inside the send rather than only by a disabled button: the identity in the cache must be
 *   able to write (a press can come after `/me` changed but before the view has drawn it), and `guard` checks again after
 *   each awaited step;
 * - an answer, success or failure, that arrives after the identity changed (`callerGeneration`) is thrown away: it is not
 *   returned (so nothing caches it), `onSuccess`, `onError` and `onSettled` do not run (no toast, no closing, no field
 *   errors for the next caller), and this hook's state goes back to idle, so its variables and answer are not kept;
 *   `clearCallerData` removes the settled mutation from the cache.
 * A write stopped before it was sent ends the same way, without `onDiscarded`: the view already shows why it cannot write.
 */
export function useWriteMutation<TData = unknown, TError = DefaultError, TVariables extends object = object, TOnMutateResult = unknown>(
  options: WriteMutationOptions<TData, TError, TVariables, TOnMutateResult>
): UseMutationResult<TData, TError, TVariables, TOnMutateResult> {
  const queryClient = useQueryClient()
  const { mutationFn, onSuccess, onError, onSettled, onDiscarded, ...rest } = options
  // The caller each write was sent as, by its variables (one object per `mutate`).
  const sentAs = useRef(new WeakMap<object, number>())
  const latest = useRef<UseMutationResult<TData, TError, TVariables, TOnMutateResult> | null>(null)

  const stale = (variables: TVariables) => sentAs.current.get(variables) !== callerGeneration(queryClient)
  const ours = (error: unknown) => error instanceof CallerChangedError || error instanceof WriteNotAllowedError
  // Back to idle, if this hook still shows that write (it may have moved on to a newer one).
  const forget = (variables: TVariables) => {
    if (latest.current?.variables === variables) latest.current.reset()
  }

  const result = useMutation<TData, TError, TVariables, TOnMutateResult>({
    ...rest,
    mutationFn: async (variables, context) => {
      sentAs.current.set(variables, callerGeneration(queryClient))
      const guard = writeGuard(queryClient)
      guard()
      let data: TData
      try {
        data = await mutationFn(variables, guard, context)
      } catch (error) {
        throw stale(variables) ? new CallerChangedError() : error
      }
      if (stale(variables)) throw new CallerChangedError()
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
  useEffect(() => {
    latest.current = result
  })
  return result
}
