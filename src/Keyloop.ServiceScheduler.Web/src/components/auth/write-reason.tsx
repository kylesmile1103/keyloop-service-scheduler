import { Eye } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Why a control that changes bookings is unavailable to this account, on screen and named by the control's
 * `aria-describedby` (UI_DESIGN 11.20): a screen reader reads it with the control, and sighted users see it without
 * hovering. One note serves every such control in its view.
 */
export function WriteReason({ id, reason, className }: { id: string; reason: string; className?: string }) {
  return (
    <p
      id={id}
      data-slot="write-reason"
      className={cn("flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-pretty text-foreground", className)}
    >
      <Eye aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span>{reason}</span>
    </p>
  )
}
