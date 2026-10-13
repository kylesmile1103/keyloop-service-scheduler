import { TriangleAlert } from "lucide-react"
import { type ReactNode, use } from "react"

import { SignInAction } from "@/components/auth/sign-in-action"
import { Button } from "@/components/ui/button"
import { SessionRenewalContext } from "@/contexts/session-renewal-context"
import { useSessionRenewal } from "@/hooks/use-session-renewal"
import { identitySource } from "@/lib/session"

/** The end of a sign-in on this device's clock (24-hour), where the person is. */
const endTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

/** Runs the tab's session renewal once and shares it with the session banner of whichever page is shown (root layout). */
export function SessionRenewalProvider({ children }: { children: ReactNode }) {
  const renewal = useSessionRenewal()
  return <SessionRenewalContext value={renewal}>{children}</SessionRenewalContext>
}

/**
 * The session banner (UI_DESIGN 11.20), under every page's header. While work is open when the sign-in is about to end:
 * "Your sign-in ends at 14:05. Save or finish what you are doing, then stay signed in.", with **Not now** and **Stay signed
 * in**; once it has ended: "Your sign-in ended.", with **Not now** and **Sign in again** (*How to sign in* on the development
 * server, whose identity is configuration). Both renew by navigating to the API's login path, back to this page
 * (lib/session-renewal.ts). Nothing at all for a sign-in renewed in time, the Development identity or a visitor who never
 * signed in. It never takes focus: it is announced politely and follows the header in the tab order.
 */
export function SessionBanner() {
  const renewal = use(SessionRenewalContext)
  const notice = renewal?.notice ?? null
  return (
    // Always there, so a banner put into it is announced; Base UI leaves `aria-live` regions readable while a dialog is open,
    // which is where the work it is about usually is.
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

/**
 * The same notice inside a dialog or sheet (components/ui/dialog.tsx and sheet.tsx render it last), where the work it is
 * about usually is: a modal covers the page's banner, so its bottom row says when the sign-in ends. Words only: *Stay
 * signed in* navigates, so it stays on the page, for after the work is saved or finished. Nothing once the sign-in has
 * ended (the page's banner, the session dialog and the identity rules answer that), and nothing outside the root layout.
 */
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
