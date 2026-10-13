import type { ComponentProps, ReactNode } from "react"

import { WriteReason } from "@/components/auth/write-reason"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface AdminButtonProps extends ComponentProps<typeof Button> {
  admin: boolean
  /** The id of the reason a non-Admin sees (`ReadOnlyNote`), which the unavailable button names. */
  reasonId: string
  children: ReactNode
}

/**
 * A page's edit action (Add technician, Add bay): usable for an Admin; for anyone else unavailable but focusable, named by
 * the reason on screen (`aria-describedby`), never a tooltip alone.
 */
export function AdminButton({ admin, reasonId, children, className, ...props }: AdminButtonProps) {
  return (
    <Button
      type="button"
      {...props}
      disabled={!admin || props.disabled}
      focusableWhenDisabled
      aria-describedby={admin ? undefined : reasonId}
      className={cn("cursor-pointer", className)}
    >
      {children}
    </Button>
  )
}

/** Why the page's edit actions are unavailable to this role: the shared `WriteReason` note. */
export function ReadOnlyNote({ id, reason, className }: { id: string; reason: string; className?: string }) {
  return <WriteReason id={id} reason={reason} className={className} />
}
