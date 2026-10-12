import type { AppointmentListItemResponse } from "@/api/types.gen"
import { jobCardLabel, timeRange } from "@/app/dispatch/lib/appointment-text"
import { statusMeta } from "@/app/dispatch/lib/status"
import { formatLocalTime } from "@/lib/local-time"
import { cn } from "@/lib/utils"

interface AppointmentChipProps {
  appointment: AppointmentListItemResponse
  timeZone: string
  /** A week column's three lines, or a month cell's one. */
  density: "week" | "month"
  selected: boolean
  onSelect: (appointment: AppointmentListItemResponse, chip: HTMLElement) => void
}

/**
 * An appointment on the Calendar: a button in its status's tint, marker bar and ink with the status icon (UI_DESIGN 11.12's
 * block, never colour alone), named as the board's job cards are ("Interim Service, Bay 1 - Standard, 08:00 to 09:00,
 * Sophie Turner, Amelia Clarke, Confirmed"). A week column shows the time range, the service and the customer; a month
 * cell the start and the service on one line. A click opens the board's details sheet.
 */
export function AppointmentChip({ appointment, timeZone, density, selected, onSelect }: AppointmentChipProps) {
  const { icon: StatusIcon, classes } = statusMeta[appointment.status]
  return (
    <button
      type="button"
      aria-label={jobCardLabel(appointment, timeZone)}
      aria-haspopup="dialog"
      aria-expanded={selected}
      data-appointment-id={appointment.id}
      data-selected={selected || undefined}
      onClick={(event) => onSelect(appointment, event.currentTarget)}
      className={cn(
        "flex w-full min-w-0 cursor-pointer rounded-md border-l-3 text-left text-dense outline-none transition-shadow duration-150 hover:shadow-md pointer-coarse:min-h-11",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card data-selected:ring-2 data-selected:ring-primary",
        density === "week" ? "flex-col gap-0.5 px-2 py-1.5" : "items-center gap-1 px-1.5 py-0.5",
        classes.block
      )}
    >
      {density === "week" ? (
        <>
          <span className="flex min-w-0 items-center gap-1 font-semibold tabular-nums">
            <StatusIcon aria-hidden="true" className="size-3.5 shrink-0" />
            {/* In a narrow week column (UI_DESIGN 11.22) the start alone; the name still reads the whole range. */}
            <span className="truncate @[8rem]/day:hidden">{formatLocalTime(appointment.startUtc, timeZone)}</span>
            <span className="hidden truncate @[8rem]/day:inline">{timeRange(appointment, timeZone)}</span>
          </span>
          <span className="truncate font-medium">{appointment.serviceType.name}</span>
          <span className="truncate">{appointment.customerName}</span>
        </>
      ) : (
        <>
          <StatusIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="shrink-0 font-semibold tabular-nums">{formatLocalTime(appointment.startUtc, timeZone)}</span>
          <span className="min-w-0 truncate">{appointment.serviceType.name}</span>
        </>
      )}
    </button>
  )
}
