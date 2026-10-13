import { ShieldAlert } from "lucide-react"
import { useId } from "react"

import type { CompetenceWarningResponse } from "@/api/types.gen"
import { competenceReason, NEEDS_REVIEW, type WarningContext } from "@/lib/competence-warnings"
import { cn } from "@/lib/utils"

/** Decorative warning pill rendered on appointment blocks and cards that require competence review. */
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

/** Warning section in appointment details listing competence mismatch reasons. */
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
