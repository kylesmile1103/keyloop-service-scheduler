import { Warehouse } from "lucide-react"
import type { CSSProperties } from "react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { appointmentLabel, firstName, initials, timeRange } from "../lib/appointment-text"
import type { BoardAppointment, LaneMode } from "../lib/schedule"
import { statusMeta } from "../lib/status"

interface AppointmentBlockProps {
  appointment: BoardAppointment
  /** The lane view: a bay's block names its technician, a technician's block names its bay. */
  mode: LaneMode
  timeZone: string
  /** The block's place on the timeline (`grid-column`, `grid-row`). */
  style: CSSProperties
  /** Its details sheet is open. */
  selected: boolean
  onSelect: (appointment: BoardAppointment, block: HTMLElement) => void
}

/** The VIN and registration as the workshop writes them: a plate chip, then the VIN in monospace. */
export function PlateChip({
  registration,
  labelled = true,
  className,
}: {
  registration: string
  /** Announce "Registration" before the plate; off where a visible label already says so. */
  labelled?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-[4px] border border-input bg-card px-1 font-mono leading-4 tracking-wide text-foreground uppercase",
        className
      )}
    >
      {labelled && <span className="sr-only">Registration </span>}
      {registration}
    </span>
  )
}

/**
 * One appointment on the timeline: a button in its status's colours (and icon) spanning its time. A narrow block keeps the
 * start of the service name and the avatar; wider ones add the status icon, the plate, the technician's first name (a
 * two-hour job at 1440 px shows it), and the VIN once it fits whole: a VIN cut short identifies nothing. Hover or focus
 * shows the whole record; a click opens the details sheet.
 */
export function AppointmentBlock({ appointment, mode, timeZone, style, selected, onSelect }: AppointmentBlockProps) {
  const { icon: StatusIcon, classes, label: statusLabel } = statusMeta[appointment.status]
  const counterpart = mode === "bays" ? appointment.technician.name : appointment.bay.name

  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        aria-label={appointmentLabel(appointment, timeZone)}
        aria-haspopup="dialog"
        aria-expanded={selected}
        data-appointment-id={appointment.id}
        data-selected={selected || undefined}
        onClick={(event) => onSelect(appointment, event.currentTarget)}
        style={style}
        className={cn(
          "@container/block relative z-[1] mx-px my-1 flex min-w-0 cursor-pointer flex-col justify-center gap-1 overflow-hidden rounded-md border-l-3 px-1.5 py-1 text-left text-[13px] leading-4 shadow-xs outline-none",
          "transition-shadow duration-150 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card",
          "data-selected:ring-2 data-selected:ring-primary data-selected:ring-offset-1 data-selected:ring-offset-card",
          classes.block
        )}
      >
        <span className="flex min-w-0 items-center gap-1">
          {/* Under 4.5rem the name needs the room; the tooltip, the sheet and the label still give the status in words. */}
          <StatusIcon aria-hidden="true" className="size-3.5 shrink-0 @max-[4.5rem]/block:hidden" />
          <span className="truncate font-semibold">{appointment.serviceType.name}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
          <PlateChip registration={appointment.registration} className="@max-[5.5rem]/block:hidden" />
          <span className="hidden min-w-0 truncate font-mono tracking-wide @min-[16rem]/block:inline">{appointment.vin}</span>
          <span className="ml-auto flex min-w-0 items-center gap-1 @max-[5.5rem]/block:ml-0">
            {mode === "bays" ? (
              <>
                <Avatar className="size-5 ring-1 ring-card after:hidden">
                  <AvatarFallback className="bg-secondary text-[9px] font-semibold text-secondary-foreground">
                    {initials(counterpart)}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden min-w-0 truncate font-medium @min-[9rem]/block:inline">{firstName(counterpart)}</span>
              </>
            ) : (
              <>
                <Warehouse aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="hidden max-w-32 truncate font-medium @min-[8rem]/block:inline">{counterpart}</span>
              </>
            )}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="flex-col items-start gap-0.5 text-left">
        <span className="font-semibold">{appointment.serviceType.name}</span>
        <span className="tabular-nums">{`${timeRange(appointment, timeZone)}, ${statusLabel}`}</span>
        <span>{`${appointment.bay.name}, ${appointment.technician.name}`}</span>
        <span>{appointment.customerName}</span>
        <span className="font-mono tracking-wide">{`${appointment.registration}  ${appointment.vin}`}</span>
      </TooltipContent>
    </Tooltip>
  )
}
