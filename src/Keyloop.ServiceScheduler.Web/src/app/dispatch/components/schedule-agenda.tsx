import { ChevronDown } from "lucide-react"
import { Fragment, useId } from "react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

import { jobCardLabel, timeRange } from "../lib/appointment-text"
import type { BoardAppointment, Lane, LaneMode } from "../lib/schedule"
import { statusMeta } from "../lib/status"
import { formatLocalTime } from "../lib/time-grid"
import { PlateChip } from "./appointment-block"
import { InitialsAvatar } from "./initials-avatar"
import { StatusBadge } from "./status-badge"

interface ScheduleAgendaProps {
  lanes: readonly Lane[]
  mode: LaneMode
  timeZone: string
  /** The current instant when the agenda shows today; `null` on any other day. */
  now: Date | null
  selectedId: string | null
  /** A booking just made: its card draws the booked halo (DESIGN_SYSTEM 10). */
  bookedId?: string | null
  onSelect: (appointment: BoardAppointment, card: HTMLElement) => void
}

/**
 * The board on a phone: the same lanes as the timeline, as collapsible sections of time-ordered job cards (the template
 * calendar's list view, regrouped by bay or technician, with Service Hub's job card anatomy, DESIGN_SYSTEM 11.13). Each lane
 * header stays in view while its cards scroll; today's lists mark "now" between past and coming work.
 */
export function ScheduleAgenda({ lanes, ...rest }: ScheduleAgendaProps) {
  return (
    <div className="flex flex-col gap-2">
      {lanes.map((lane) => (
        <AgendaLane key={lane.id} lane={lane} {...rest} />
      ))}
    </div>
  )
}

function AgendaLane({ lane, mode, timeZone, now, selectedId, bookedId, onSelect }: { lane: Lane } & Omit<ScheduleAgendaProps, "lanes">) {
  const headingId = useId()
  const count = lane.appointments.length
  // "Now" goes before the first appointment still to start; one already under way stays above it.
  const nowIndex = now ? lane.appointments.findIndex((appointment) => Date.parse(appointment.startUtc) > now.getTime()) : -1
  const nowAt = now && count > 0 ? (nowIndex === -1 ? count : nowIndex) : null

  return (
    <section aria-labelledby={headingId}>
      <Collapsible defaultOpen>
        <h3 id={headingId} className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 text-sm font-semibold backdrop-blur">
          <CollapsibleTrigger className="group/lane flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className={cn("min-w-0 flex-1 truncate", !lane.isActive && "text-muted-foreground")}>{lane.name}</span>
            {!lane.isActive && (
              <span className="shrink-0 rounded-full border border-dashed border-input px-2 text-2xs leading-5 font-medium text-muted-foreground">
                {mode === "bays" ? "Out of service" : "Inactive"}
              </span>
            )}
            <span className="shrink-0 font-normal text-muted-foreground tabular-nums">
              {count}
              <span className="sr-only">{count === 1 ? " appointment" : " appointments"}</span>
            </span>
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-data-panel-open/lane:rotate-180"
            />
          </CollapsibleTrigger>
        </h3>
        <CollapsibleContent className="pb-2">
          {count === 0 ? (
            <p className="rounded-chip border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">No appointments</p>
          ) : (
            <ol className="flex flex-col gap-2 pt-1">
              {lane.appointments.map((appointment, index) => (
                <Fragment key={appointment.id}>
                  {nowAt === index && now && <NowDivider now={now} timeZone={timeZone} />}
                  <li>
                    <JobCard
                      appointment={appointment}
                      mode={mode}
                      timeZone={timeZone}
                      selected={appointment.id === selectedId}
                      booked={appointment.id === bookedId}
                      onSelect={onSelect}
                    />
                  </li>
                </Fragment>
              ))}
              {nowAt === count && now && <NowDivider now={now} timeZone={timeZone} />}
            </ol>
          )}
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}

/** "Now" between today's past and coming cards: the timeline's now line, as a divider with its time pill. */
function NowDivider({ now, timeZone }: { now: Date; timeZone: string }) {
  return (
    <li className="flex items-center gap-2 py-0.5">
      <span className="rounded-full bg-destructive px-1.5 text-2xs font-semibold text-destructive-foreground tabular-nums">
        {`Now ${formatLocalTime(now.toISOString(), timeZone)}`}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-destructive" />
    </li>
  )
}

interface JobCardProps {
  appointment: BoardAppointment
  mode: LaneMode
  timeZone: string
  selected: boolean
  booked: boolean
  onSelect: (appointment: BoardAppointment, card: HTMLElement) => void
}

/**
 * A job card: the time range (and, in the bay view, the technician's avatar), the customer, the plate and VIN, then the
 * status and the service with the other resource, so every card names both the bay and the technician (one in the lane
 * header). The whole card opens the details.
 */
function JobCard({ appointment, mode, timeZone, selected, booked, onSelect }: JobCardProps) {
  const other = mode === "bays" ? appointment.technician.name : appointment.bay.name

  return (
    <button
      type="button"
      aria-label={jobCardLabel(appointment, timeZone)}
      aria-haspopup="dialog"
      aria-expanded={selected}
      data-appointment-id={appointment.id}
      data-selected={selected || undefined}
      data-booked={booked || undefined}
      onClick={(event) => onSelect(appointment, event.currentTarget)}
      className={cn(
        "flex min-h-11 w-full cursor-pointer flex-col gap-1.5 rounded-chip border-l-3 bg-card p-3 text-left shadow-xs ring-1 ring-foreground/10 outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring data-selected:ring-2 data-selected:ring-primary",
        "data-booked:animate-booked data-booked:ring-2 data-booked:ring-ring",
        statusMeta[appointment.status].classes.bar
      )}
    >
      <span className="flex min-w-0 items-center justify-between gap-2">
        <span className="text-dense font-semibold tabular-nums">{timeRange(appointment, timeZone)}</span>
        {mode === "bays" && <InitialsAvatar name={appointment.technician.name} />}
      </span>
      <span className="truncate text-sm font-semibold">{appointment.customerName}</span>
      <span className="flex min-w-0 items-center gap-2">
        <PlateChip registration={appointment.registration} />
        <span className="min-w-0 truncate font-mono text-xs tracking-wide text-muted-foreground">{appointment.vin}</span>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <StatusBadge status={appointment.status} />
        <span className="min-w-0 truncate text-dense">{`${appointment.serviceType.name} · ${other}`}</span>
      </span>
    </button>
  )
}
