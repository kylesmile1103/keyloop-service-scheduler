import { hashKey, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import type { CurrentUserResponse } from "@/api/types.gen"
import { SignInAction } from "@/components/auth/sign-in-action"
import { DevelopmentIdentityNote } from "@/components/auth/development-identity-note"
import { TraceIdRow } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog"
import { describeFailure, failureStatus } from "@/lib/problem-details"
import { currentUserQueryKey, identityKey } from "@/lib/session"

const UNKNOWN = "unknown"
import { clearCallerData, refetchCallerData } from "@/lib/session-cache"

interface SessionProblem {
  status: 401 | 403
  traceId?: string
  wasSignedIn: boolean
}

/**
 * Watches query and mutation cache events for 401/403 responses and `/me` identity changes,
 * clearing caller-dependent cache data and presenting a sign-in or role-refusal dialog when needed.
 */
export function SessionWatch() {
  const queryClient = useQueryClient()
  const [problem, setProblem] = useState<SessionProblem | null>(null)
  const [changes, setChanges] = useState(0)

  useEffect(() => {
    const meKey = currentUserQueryKey()
    const meHash = hashKey(meKey)
    const cached = queryClient.getQueryData<CurrentUserResponse>(meKey)
    let identity = cached ? identityKey(cached) : null
    let signedIn = cached?.authenticated === true

    const refused = (error: unknown) => {
      const status = failureStatus(error)
      if (status !== 401 && status !== 403) return
      const { traceId } = describeFailure(error)
      const next: SessionProblem = { status, traceId, wasSignedIn: signedIn }
      setProblem((current) => current ?? next)
      void queryClient.invalidateQueries({ queryKey: meKey })
    }

    const becomes = (next: string) => {
      if (identity !== null && next !== identity) {
        clearCallerData(queryClient)
        setChanges((count) => count + 1)
      }
      identity = next
    }

    const stopQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated") return
      if (event.query.queryHash !== meHash) {
        if (event.action.type === "error") refused(event.action.error)
        return
      }
      if (event.action.type === "failed" || event.action.type === "error") {
        becomes(UNKNOWN)
        signedIn = false
        return
      }
      if (event.action.type !== "success") return
      const me = event.action.data as CurrentUserResponse
      becomes(identityKey(me))
      signedIn = me.authenticated
    })
    const stopMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") refused(event.action.error)
    })
    return () => {
      stopQueries()
      stopMutations()
    }
  }, [queryClient])

  useEffect(() => {
    if (changes === 0) return
    const timer = setTimeout(() => void refetchCallerData(queryClient), 0)
    return () => clearTimeout(timer)
  }, [changes, queryClient])

  return <SessionProblemDialog problem={problem} onClose={() => setProblem(null)} />
}

function SessionProblemDialog({ problem, onClose }: { problem: SessionProblem | null; onClose: () => void }) {
  // Kept while the dialog animates closed.
  const [shown, setShown] = useState(problem)
  if (problem && problem !== shown) setShown(problem)
  const signIn = useRef<HTMLAnchorElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const current = problem ?? shown

  return (
    <Dialog open={problem !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        initialFocus={() => (current?.status === 401 ? signIn.current : close.current) ?? true}
        // Each answer has its own way out (Not now, Close), and Escape closes it too.
        showCloseButton={false}
        className="gap-0 p-0 sm:max-w-md"
      >
        {current && (
          <>
            {/* min-w-0: a grid item may not grow past the dialog for the trace id's unbroken text. */}
            <div className="flex min-w-0 flex-col gap-2 px-6 pt-6 pb-5">
              <DialogTitle className="font-heading text-lg leading-snug font-semibold text-balance">
                {current.status === 403
                  ? "Your role doesn’t allow that"
                  : current.wasSignedIn
                    ? "Your session has ended"
                    : "Sign in to continue"}
              </DialogTitle>
              <DialogDescription className="text-pretty">
                {current.status === 403
                  ? "The scheduler refused because your account’s role does not include this. Roles are assigned by the workshop administrator."
                  : current.wasSignedIn
                    ? "Sign in again to carry on. Anything not yet saved on this page, such as a booking being entered, will need entering again."
                    : "That needs a workshop account. Anything not yet saved on this page will need entering again after you sign in."}
              </DialogDescription>
              {current.status === 401 && <DevelopmentIdentityNote className="max-w-none" />}
              {current.traceId && <TraceIdRow traceId={current.traceId} className="max-w-full pt-1" />}
            </div>
            <DialogFooter className="mx-0 mb-0 min-w-0 px-6 max-sm:*:w-full">
              {current.status === 401 ? (
                <>
                  <DialogClose render={<Button variant="outline" />}>Not now</DialogClose>
                  <SignInAction ref={signIn} />
                </>
              ) : (
                <DialogClose ref={close} render={<Button />}>
                  Close
                </DialogClose>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
