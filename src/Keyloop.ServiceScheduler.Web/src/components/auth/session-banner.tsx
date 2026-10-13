import { TriangleAlert } from "lucide-react"
import { type ReactNode, use } from "react"

import { SignInAction } from "@/components/auth/sign-in-action"
import { Button } from "@/components/ui/button"
import { SessionRenewalContext } from "@/contexts/session-renewal-context"
import { useSessionRenewal } from "@/hooks/use-session-renewal"
import { identitySource } from "@/lib/session"

const endTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

/** Provides session renewal state to the page banner and modal notices. */
export function SessionRenewalProvider({ children }: { children: ReactNode }) {
  const renewal = useSessionRenewal()
  return <SessionRenewalContext value={renewal}>{children}</SessionRenewalContext>
}

/** Polite status banner displayed beneath the site header when the session is ending with unsaved work or has ended. */
export function SessionBanner() {
  const renewal = use(SessionRenewalContext)
  const notice = renewal?.notice ?? null
  return (
    <div aria-live="polite">
      {renewal && notice && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-warning/30 bg-warning-subtle px-4 py-2.5 md:px-6 xl:px-8"
        >
          <p className="flex min-w-0 flex-[1_1_18rem] items-start gap-2 text-sm text-pretty text-foreground">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
            {notice.kind === "ending" ? (
              <span>
                <strong className="font-semibold text-warning">{`Your sign-in ends at ${endTime.format(notice.endsAt)}.`}</strong> Save or
                finish what you are doing, then stay signed in.
              </span>
            ) : (
              <span>
                <strong className="font-semibold text-warning">Your sign-in ended.</strong> Sign in again to carry on where you left off.
              </span>
            )}
          </p>
          <div className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:justify-end">
            <Button variant="outline" size="sm" onClick={renewal.dismiss}>
              Not now
            </Button>
            {notice.kind === "ended" && identitySource() === "configuration" ? (
              <SignInAction size="sm" />
            ) : (
              <Button size="sm" onClick={renewal.renew}>
                {notice.kind === "ending" ? "Stay signed in" : "Sign in again"}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Inline footer notice inside dialogs and sheets when the session is about to expire while modal work is open. */
export function SessionNoticeInModal() {
  const notice = use(SessionRenewalContext)?.notice
  if (notice?.kind !== "ending") return null
  return (
    <p
      data-slot="session-notice"
      className="flex shrink-0 items-start gap-2 border-t border-warning/30 bg-warning-subtle px-4 py-2.5 text-sm text-pretty text-foreground sm:px-6"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
      <span>
        <strong className="font-semibold text-warning">{`Your sign-in ends at ${endTime.format(notice.endsAt)}.`}</strong> Save or finish
        this, then choose Stay signed in on the page.
      </span>
    </p>
  )
}
