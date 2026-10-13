import { type ReactNode, useId, useRef } from "react"

import { DevelopmentIdentityNote } from "@/components/auth/development-identity-note"
import { IdentityCheckFailed } from "@/components/auth/identity-check-failed"
import { SignInAction } from "@/components/auth/sign-in-action"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog"
import { illustrationAlt, illustrations } from "@/lib/illustrations"
import { cn } from "@/lib/utils"

interface SignInPromptProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Modal dialog prompting an unauthenticated visitor to sign in before booking an appointment. */
export function SignInPrompt({ open, onOpenChange }: SignInPromptProps) {
  const signIn = useRef<HTMLAnchorElement>(null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent initialFocus={signIn} className="gap-0 p-0 sm:max-w-md">
        <div className="flex flex-col items-center gap-3 px-6 pt-8 pb-6 text-center">
          <img
            src={illustrations["sign-in-to-book"]}
            alt={illustrationAlt["sign-in-to-book"]}
            width={1200}
            height={900}
            draggable={false}
            className="pointer-events-none h-auto w-40 select-none md:w-48"
          />
          <DialogTitle className="font-heading text-lg leading-snug font-semibold text-balance">Sign in to book</DialogTitle>
          <DialogDescription className="max-w-xs text-pretty">
            Booking needs a workshop account with the Admin or Service advisor role. Anyone can view the board, with customer
            details masked.
          </DialogDescription>
          <DevelopmentIdentityNote />
          <IdentityCheckFailed className="items-center" />
        </div>
        <DialogFooter className="mx-0 mb-0 px-6 max-sm:*:w-full">
          <DialogClose render={<Button variant="outline" />}>Not now</DialogClose>
          <SignInAction ref={signIn} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface SignInPanelProps {
  title: string
  children: ReactNode
  className?: string
}

/** Inline sign-in callout card rendered inside views that require authentication for full details. */
export function SignInPanel({ title, children, className }: SignInPanelProps) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-4", className)}
    >
      <img
        src={illustrations["sign-in-to-book"]}
        alt={illustrationAlt["sign-in-to-book"]}
        width={1200}
        height={900}
        draggable={false}
        className="pointer-events-none h-auto w-24 shrink-0 select-none self-center"
      />
      <div className="flex min-w-0 flex-col gap-2">
        <h3 id={headingId} className="font-heading text-base font-semibold text-balance">
          {title}
        </h3>
        <div className="flex flex-col gap-1 text-sm text-pretty text-muted-foreground">{children}</div>
        <DevelopmentIdentityNote />
        <IdentityCheckFailed />
        <SignInAction size="sm" className="mt-1 self-start" />
      </div>
    </section>
  )
}
