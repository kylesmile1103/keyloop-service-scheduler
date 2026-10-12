import type { AppointmentStatus } from "@/api/types.gen"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

import { statusMeta } from "../lib/status"

/** A status as icon and words on its own tint: never colour alone. */
export function StatusBadge({ status, className }: { status: AppointmentStatus; className?: string }) {
  const { label, icon: Icon, classes } = statusMeta[status]
  return (
    <Badge variant="outline" className={cn("border-transparent ring-1 ring-inset", classes.badge, className)}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  )
}
