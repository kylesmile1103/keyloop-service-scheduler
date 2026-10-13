import { ShieldAlert } from "lucide-react"
import { useId } from "react"

import type { CompetenceWarningResponse } from "@/api/types.gen"
import { competenceReason, NEEDS_REVIEW, type WarningContext } from "@/lib/competence-warnings"
import { cn } from "@/lib/utils"

/**
 * The mark on a flagged block or job card (UI_DESIGN 11.24): a small pill on the card's own fill, `ShieldAlert` and the word,
 * in the warning ink. It sits on the card colour, not the status tint, so it reads on every status (the in-progress amber
 * included) and never stands in for a status. Decorative to assistive technology: the block's label already ends with
 * "needs review".
 */
export function ReviewMark({ label = "Review", className }: { label?: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-slot="review-mark"
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-card px-1.5 text-2xs font-semibold text-warning ring-1 ring-warning/50",
        className
      )}
    >
      <ShieldAlert className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  )
}

interface CompetenceWarningNoticeProps extends WarningContext {
  warning: CompetenceWarningResponse
  className?: string
}

/**
 * The details sheet's account of a warning: a region named "Needs review" in the warning treatment (11.16), one line per
 * reason naming the technician or bay, and what the flag does and does not do: nothing was moved, a person decides.
 */
export function CompetenceWarningNotice({ warning, technician, bay, day, className }: CompetenceWarningNoticeProps) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex gap-3 rounded-xl border border-warning/30 bg-warning-subtle px-3 py-3 text-sm text-foreground", className)}
    >
      <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="flex min-w-0 flex-col gap-1.5 text-pretty">
        <h3 id={headingId} className="font-semibold text-warning">
          {NEEDS_REVIEW}
        </h3>
        <ul className="flex flex-col gap-1">
          {warning.reasonCodes.map((code) => (
            <li key={code}>{competenceReason(code, { technician, bay, day })}</li>
          ))}
        </ul>
        <p className="text-muted-foreground">
          Nothing has been moved: the appointment keeps its bay, technician and time until someone reassigns or rebooks it.
        </p>
      </div>
    </section>
  )
}
