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

/** The identity while `/me` cannot be read: nobody known, the same to the cache as a change of caller. */
const UNKNOWN = "unknown"
import { clearCallerData, refetchCallerData } from "@/lib/session-cache"

interface SessionProblem {
  status: 401 | 403
  traceId?: string
  /** Whether the API knew a signed-in user before this refusal (the session ended) or not (it never began). */
  wasSignedIn: boolean
}

/**
 * The one place the app answers the server's word on identity (ARCHITECTURE §15, UI_DESIGN 11.20):
 * - a `401` from any query or mutation opens "Your session has ended" with Sign in (the API's login path on this origin,
 *   back to this page; the problem's own `loginUrl` is never followed); a `403` opens "Your role doesn't allow that".
 *   Either reads `/me` again;
 * - when `/me` names another caller than before (signed in or out, another email, other roles), or cannot be read (nobody
 *   is known until it answers again), whatever the previous caller read is cleared (lib/session-cache.ts) and the views
 *   read it again as the new one.
 * Mounted once, after the routes in the root layout. The re-read can still come before a view has rendered for the new
 * caller, so a read only a role may make decides at fetch time from the cached identity (the details sheet's record).
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
      // The first refusal of a burst is the one to answer; the rest say the same.
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
      // A failed read, already at its first attempt (before TanStack's own retry): whoever was signed in may not be any
      // more, so what they read goes now, as on any change; the next answer is a change again (and clears what was read
      // meanwhile), even when it names the same caller.
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
    if (changes > 0) void refetchCallerData(queryClient)
  }, [changes, queryClient])

  return <SessionProblemDialog problem={problem} onClose={() => setProblem(null)} />
}

/** The answer to a refusal: sign in again (401), or what the role does not allow (403). */
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
