import { CapabilityBadges } from "@/components/capability-badges"
import { ShareMeter } from "@/components/stat-card"
import { countOf } from "@/lib/data-table"

import { ActiveState } from "../components/resource-cells"
import type { BayRecord } from "../lib/resources"
import { BAY_WORDS } from "./columns"

const APPOINTMENTS = { one: "appointment today", other: "appointments today" }

/**
 * The bays on a phone, one card per bay in the table's order: the name, whether it is in service, its equipment, and
 * today's appointments with the bay's load as a meter of the opening hours. Read-only; each name is a heading.
 */
export function BayCards({ rows }: { rows: readonly BayRecord[] }) {
  return (
    <ol aria-label="Bays" className="flex flex-col gap-2">
      {rows.map((row) => {
        const window = row.today.windowMinutes
        const share = window ? row.today.bookedMinutes / window : 0
        return (
          <li key={row.id} className="flex flex-col gap-2.5 rounded-chip bg-card p-3 shadow-xs ring-1 ring-foreground/10">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <h3 className="min-w-0 truncate pt-0.5 text-sm font-semibold">{row.name}</h3>
              <ActiveState active={row.isActive} words={BAY_WORDS} />
            </div>
            <CapabilityBadges capabilities={row.capabilities} max={4} className="flex-wrap" />
            <div className="flex flex-col gap-1.5 border-t pt-2.5">
              <div className="flex items-baseline justify-between gap-3 text-dense tabular-nums">
                <span>{countOf(row.today.appointments, APPOINTMENTS)}</span>
                <span className="text-muted-foreground">{window === null ? "Closed today" : `${Math.round(share * 100)}% loaded`}</span>
              </div>
              {window !== null && <ShareMeter share={share} className="mb-0" />}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
