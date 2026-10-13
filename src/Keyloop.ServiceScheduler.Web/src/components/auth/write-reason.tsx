import { Eye, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/** Inline callout explaining why a write control is disabled for the current role, linked via `aria-describedby`. */
export function WriteReason({ id, reason, icon: Icon = Eye, className }: { id: string; reason: string; icon?: LucideIcon; className?: string }) {
  return (
    <p
      id={id}
      data-slot="write-reason"
      className={cn("flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-pretty text-foreground", className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span>{reason}</span>
    </p>
  )
}
