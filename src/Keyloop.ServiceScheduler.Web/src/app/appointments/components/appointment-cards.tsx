import { use } from "react"

import { PlateChip } from "@/app/dispatch/components/appointment-block"
import { InitialsAvatar } from "@/app/dispatch/components/initials-avatar"
import { StatusBadge } from "@/app/dispatch/components/status-badge"
import { jobCardLabel, timeRange } from "@/app/dispatch/lib/appointment-text"
import { statusMeta } from "@/app/dispatch/lib/status"
import { cn } from "@/lib/utils"

import { type AppointmentRow, durationMinutes } from "../lib/appointments"
import { OpenAppointmentContext } from "../lib/row-actions"

interface AppointmentCardsProps {
  /** The rows of the current page, filtered and sorted as the table would show them. */
  rows: readonly AppointmentRow[]
  timeZone: string
  /** The appointment whose details sheet is open. */
  selectedId: string | null
}

/**
 * The list on a phone: one job card per appointment (Service Hub's card, UI_DESIGN 11.13), in the table's order. With
 * no lane to group by, each card names both the bay and the technician. The whole card opens the details as a bottom
 * sheet, where a confirmed or checked-in appointment can be cancelled.
 */
export function AppointmentCards({ rows, timeZone, selectedId }: AppointmentCardsProps) {
  const open = use(OpenAppointmentContext)

  return (
    <ol aria-label="Appointments" className="flex flex-col gap-2">
      {rows.map((row) => {
        const selected = row.id === selectedId
        return (
          <li key={row.id}>
            <button
              type="button"
              aria-label={jobCardLabel(row, timeZone)}
              aria-haspopup="dialog"
              aria-expanded={selected}
              data-appointment-id={row.id}
              data-selected={selected || undefined}
              onClick={(event) => open(row, "details", event.currentTarget)}
              className={cn(
                "flex min-h-11 w-full cursor-pointer flex-col gap-1.5 rounded-chip border-l-3 bg-card p-3 text-left shadow-xs ring-1 ring-foreground/10 outline-none",
                // A borderless target (UI_DESIGN 15): the focus ring stands off the card by 1 px of the page it sits on.
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                "data-selected:ring-2 data-selected:ring-primary",
                statusMeta[row.status].classes.bar
              )}
            >
              <span className="flex min-w-0 items-center justify-between gap-2">
                <span className="text-dense font-semibold tabular-nums">
                  {timeRange(row, timeZone)}
                  <span className="font-normal text-muted-foreground">{` · ${durationMinutes(row)} min`}</span>
                </span>
                <InitialsAvatar name={row.technician.name} />
              </span>
              <span className="truncate text-sm font-semibold">{row.customerName}</span>
              <span className="flex min-w-0 items-center gap-2">
                <PlateChip registration={row.registration} />
                <span className="min-w-0 truncate font-mono text-xs tracking-wide text-muted-foreground">{row.vin}</span>
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <StatusBadge status={row.status} />
                <span className="min-w-0 truncate text-dense font-medium">{row.serviceType.name}</span>
              </span>
              <span className="min-w-0 truncate text-dense text-muted-foreground">{`${row.bay.name} · ${row.technician.name}`}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
