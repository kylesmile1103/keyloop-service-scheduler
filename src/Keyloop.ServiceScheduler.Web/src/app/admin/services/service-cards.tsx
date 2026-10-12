import { CapabilityBadges } from "@/components/capability-badges"
import { countOf } from "@/lib/data-table"

import type { ServiceRecord } from "../lib/resources"
import { Shortfall } from "./bookable-cell"

const BOOKED = { one: "booked today", other: "booked today" }

/**
 * The catalogue on a phone, one card per service in the table's order: the name and duration, the code, what it needs,
 * and whether this dealership can book it (with what it lacks) next to today's bookings. Read-only; each name is a heading.
 */
export function ServiceCards({ rows }: { rows: readonly ServiceRecord[] }) {
  return (
    <ol aria-label="Services" className="flex flex-col gap-2">
      {rows.map((row) => {
        return (
          <li key={row.id} className="flex flex-col gap-2.5 rounded-chip bg-card p-3 shadow-xs ring-1 ring-foreground/10">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <h3 className="truncate text-sm font-semibold">{row.name}</h3>
                <span className="font-mono text-xs tracking-wide text-muted-foreground">{row.code}</span>
              </div>
              <span className="shrink-0 text-dense font-medium tabular-nums">{`${row.durationMinutes} min`}</span>
            </div>
            <CapabilityBadges capabilities={row.requiredBayCapabilities} certifications={row.requiredCertifications} label="Needs" max={4} className="flex-wrap" />
            <div className="flex flex-col gap-1.5 border-t pt-2.5">
              <div className="flex items-baseline justify-between gap-3 text-dense tabular-nums">
                <span className={row.bookable ? undefined : "font-medium"}>{row.bookable ? "Bookable here" : "Not bookable here"}</span>
                <span className="text-muted-foreground">{countOf(row.bookedToday, BOOKED)}</span>
              </div>
              {!row.bookable && <Shortfall service={row} max={4} wrap />}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
