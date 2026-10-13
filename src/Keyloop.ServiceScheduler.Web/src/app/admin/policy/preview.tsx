import { Ban, CircleCheck, Telescope } from "lucide-react"
import { useId } from "react"

import type { PolicyEditResponse, ServiceTypeResponse } from "@/api/types.gen"
import { formatDay } from "@/lib/calendar-date"
import { cn } from "@/lib/utils"

import { previewLines } from "./rule-words"

/**
 * What publishing the draft would change (UI_DESIGN 11.24), from the API's dry-run: on the preview's date and with today's
 * roster, which services the dealership could no longer book, or could now book, for which vehicles. Each line pairs a
 * shape and words with its colour (`Ban` and "can no longer be booked", `CircleCheck` and "can now be booked"), never the
 * colour alone. The API compares bookability only: a rule that changes what a job needs without changing whether anyone
 * here can do it shows no line, which the empty state says.
 */
export function PolicyPreview({ preview, services, className }: { preview: PolicyEditResponse; services: readonly ServiceTypeResponse[] | undefined; className?: string }) {
  const headingId = useId()
  const lines = previewLines(preview.changes, services)
  const unbookable = lines.filter((line) => !line.becomesBookable).length
  return (
    <section aria-labelledby={headingId} className={cn("flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-xs", className)}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-chip bg-secondary text-secondary-foreground">
          <Telescope className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id={headingId} className="font-heading text-base font-semibold">{`What version ${preview.policy.version} would change`}</h3>
          <p className="text-sm text-pretty text-muted-foreground">
            {`With today's roster, on ${formatDay(preview.previewDate, "long")}. Booked work and appointments already made are not counted.`}
          </p>
        </div>
      </div>
      {lines.length === 0 ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-pretty">
          No service becomes bookable or unbookable with today's roster. The rules still change what each job needs.
        </p>
      ) : (
        <>
          {unbookable > 0 && (
            <p className="text-sm font-medium text-pretty">{`${unbookable === 1 ? "1 line" : `${unbookable} lines`} below would stop bookings this dealership takes today.`}</p>
          )}
          <ul className="flex flex-col divide-y divide-border rounded-lg ring-1 ring-border">
            {lines.map((line) => {
              const Icon = line.becomesBookable ? CircleCheck : Ban
              return (
                <li key={line.key} className="flex items-start gap-2.5 px-3 py-2.5 text-sm">
                  <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", line.becomesBookable ? "text-success" : "text-destructive")} />
                  <span className="text-pretty">
                    <span className="font-semibold">{line.serviceName}</span>
                    {` can ${line.becomesBookable ? "now" : "no longer"} be booked ${line.vehicles}`}
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
