import type { ReactNode } from "react"

import { CapabilityBadges } from "@/components/capability-badges"
import { InitialsAvatar } from "@/components/initials-avatar"
import { ShareMeter } from "@/components/stat-card"
import { countOf } from "@/lib/data-table"

import { ActiveState } from "../components/resource-cells"
import { formatMinutes, type TechnicianRecord } from "../lib/resources"
import { TECHNICIAN_WORDS } from "./columns"
import { CompetenceBlock } from "./competence"
import { competenceOf } from "./competence-model"

const APPOINTMENTS = { one: "appointment today", other: "appointments today" }

/**
 * The roster on a phone, one card per technician in the table's order (Service Hub's card, UI_DESIGN 11.13): the avatar,
 * name and employee number, whether they take bookings, their certifications, and today's work with its share of the
 * opening hours, and, with vehicle-aware requirements on, their HV competence. A card is not a button (an Admin's actions are
 * the row's menu in its corner); each name is a heading, for moving through the roster.
 */
export function TechnicianCards({
  rows,
  today = null,
  actions,
}: {
  rows: readonly TechnicianRecord[]
  today?: string | null
  /** An Admin's actions for a card (Task 30b): the row's menu, beside the active state. */
  actions?: (row: TechnicianRecord) => ReactNode
}) {
  return (
    <ol aria-label="Technicians" className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-2.5 rounded-chip bg-card p-3 shadow-xs ring-1 ring-foreground/10">
          <div className="flex min-w-0 items-start gap-3">
            <InitialsAvatar name={row.name} />
            <div className="flex min-w-0 flex-1 flex-col">
              <h3 className="truncate text-sm font-semibold">{row.name}</h3>
              <span className="font-mono text-xs tracking-wide text-muted-foreground">{row.employeeNumber}</span>
            </div>
            <ActiveState active={row.isActive} words={TECHNICIAN_WORDS} />
            {actions?.(row)}
          </div>
          <CapabilityBadges certifications={row.certifications} max={4} className="flex-wrap" />
          {today && <CompetenceBlock competence={competenceOf(row, today)} />}
          <div className="flex flex-col gap-1.5 border-t pt-2.5">
            <div className="flex items-baseline justify-between gap-3 text-dense tabular-nums">
              <span>{countOf(row.today.appointments, APPOINTMENTS)}</span>
              <span className="text-muted-foreground">
                {row.today.windowMinutes === null ? "Closed today" : `${formatMinutes(row.today.bookedMinutes)} booked`}
              </span>
            </div>
            {row.today.windowMinutes !== null && <ShareMeter share={row.today.bookedMinutes / row.today.windowMinutes} className="mb-0" />}
          </div>
        </li>
      ))}
    </ol>
  )
}
