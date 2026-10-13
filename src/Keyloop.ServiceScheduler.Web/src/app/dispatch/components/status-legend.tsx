import { ReviewMark } from "@/components/competence-warning"
import { NEEDS_REVIEW } from "@/lib/competence-warnings"
import { cn } from "@/lib/utils"

import { boardStatuses, statusMeta } from "../lib/status"

/**
 * The key to the board's colours: each status's swatch, icon and name; and, when the day has flagged appointments (Task
 * 30b), the Review mark with its meaning.
 */
export function StatusLegend({ review = false, className }: { review?: boolean; className?: string }) {
  return (
    <ul aria-label="Status legend" className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground", className)}>
      {boardStatuses.map((status) => {
        const { label, icon: Icon, classes } = statusMeta[status]
        return (
          <li key={status} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cn("size-2.5 rounded-full", classes.dot)} />
            <Icon aria-hidden="true" className="size-3.5" />
            {label}
          </li>
        )
      })}
      {review && (
        <li className="flex items-center gap-1.5">
          <ReviewMark />
          {`${NEEDS_REVIEW}: its technician or bay no longer qualifies`}
        </li>
      )}
    </ul>
  )
}
