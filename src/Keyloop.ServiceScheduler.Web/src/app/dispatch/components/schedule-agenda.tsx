import { ChevronDown, Warehouse } from "lucide-react"
import { Fragment, useId } from "react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

import { appointmentLabel, initials, timeRange } from "../lib/appointment-text"
import type { BoardAppointment, Lane, LaneMode } from "../lib/schedule"
import { statusMeta } from "../lib/status"
import { formatLocalTime } from "../lib/time-grid"
import { PlateChip } from "./appointment-block"
import { StatusBadge } from "./status-badge"

interface ScheduleAgendaProps {
  lanes: readonly Lane[]
  mode: LaneMode
  timeZone: string
  /** The current instant when the agenda shows today; `null` on any other day. */
  now: Date | null
  selectedId: string | null
  onSelect: (appointment: BoardAppointment, card: HTMLElement) => void
}

/**
 * The board on a phone: the same lanes as the timeline, as collapsible sections of time-ordered job cards (the template
 * calendar's list view, regrouped by bay or technician). Today's lists mark "now" between past and coming work.
 */
export function ScheduleAgenda({ lanes, mode, timeZone, now, selectedId, onSelect }: ScheduleAgendaProps) {
  return (
    <div className="flex flex-col gap-3">
      {lanes.map((lane) => (
        <AgendaLane key={lane.id} lane={lane} mode={mode} timeZone={timeZone} now={now} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  )
}

function AgendaLane({ lane, mode, timeZone, now, selectedId, onSelect }: { lane: Lane } & Omit<ScheduleAgendaProps, "lanes">) {
  const headingId = useId()
  const count = lane.appointments.length
  // "Now" goes before the first appointment still to start; one already under way stays above it.
  const nowIndex = now ? lane.appointments.findIndex((appointment) => Date.parse(appointment.startUtc) > now.getTime()) : -1
  const nowAt = now && count > 0 ? (nowIndex === -1 ? count : nowIndex) : null

  return (
    <section aria-labelledby={headingId} className="rounded-xl bg-muted/40 ring-1 ring-foreground/5">
      <Collapsible defaultOpen>
        <h3 id={headingId} className="text-sm">
          <CollapsibleTrigger className="group/lane flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className={cn("min-w-0 flex-1 truncate font-semibold", !lane.isActive && "text-muted-foreground")}>{lane.name}</span>
            {!lane.isActive && (
              <span className="shrink-0 rounded-full border border-dashed px-2 text-[11px] leading-5 text-muted-foreground">
                {mode === "bays" ? "Out of service" : "Inactive"}
              </span>
            )}
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {count}
              <span className="sr-only">{count === 1 ? " appointment" : " appointments"}</span>
            </span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open/lane:rotate-180" />
          </CollapsibleTrigger>
        </h3>
        <CollapsibleContent className="px-2 pb-2">
          {count === 0 ? (
            <p className="px-1 pb-1 text-sm text-muted-foreground">No appointments</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {lane.appointments.map((appointment, index) => (
                <Fragment key={appointment.id}>
                  {nowAt === index && now && <NowDivider now={now} timeZone={timeZone} />}
                  <li>
                    <AgendaCard
                      appointment={appointment}
                      mode={mode}
                      timeZone={timeZone}
                      selected={appointment.id === selectedId}
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

function NowDivider({ now, timeZone }: { now: Date; timeZone: string }) {
  return (
    <li className="flex items-center gap-2 px-1 text-[11px] font-semibold text-destructive tabular-nums">
      <span className="rounded-full bg-card px-1.5 leading-4 ring-1 ring-destructive">{`Now ${formatLocalTime(now.toISOString(), timeZone)}`}</span>
      <span aria-hidden="true" className="h-0.5 flex-1 rounded-full bg-destructive" />
    </li>
  )
}

interface AgendaCardProps {
  appointment: BoardAppointment
  mode: LaneMode
  timeZone: string
  selected: boolean
  onSelect: (appointment: BoardAppointment, card: HTMLElement) => void
}

/** A job card: time and counterpart, service, plate and VIN, status and customer. The whole card opens the details. */
function AgendaCard({ appointment, mode, timeZone, selected, onSelect }: AgendaCardProps) {
  const counterpart = mode === "bays" ? appointment.technician.name : appointment.bay.name

  return (
    <button
      type="button"
      aria-label={appointmentLabel(appointment, timeZone)}
      aria-haspopup="dialog"
      aria-expanded={selected}
      data-appointment-id={appointment.id}
      data-selected={selected || undefined}
      onClick={(event) => onSelect(appointment, event.currentTarget)}
      className={cn(
        "flex min-h-11 w-full cursor-pointer flex-col gap-1.5 rounded-lg border-l-3 bg-card p-3 text-left shadow-xs ring-1 ring-foreground/10 outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring data-selected:ring-2 data-selected:ring-primary",
        statusMeta[appointment.status].classes.bar
      )}
    >
      <span className="flex min-w-0 items-center justify-between gap-2 text-sm">
        <span className="font-semibold tabular-nums">{timeRange(appointment, timeZone)}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <span className="truncate">{counterpart}</span>
          {mode === "bays" ? (
            <Avatar className="size-6 after:hidden">
              <AvatarFallback className="bg-secondary text-[10px] font-semibold text-secondary-foreground">{initials(counterpart)}</AvatarFallback>
            </Avatar>
          ) : (
            <Warehouse aria-hidden="true" className="size-4 shrink-0" />
          )}
        </span>
      </span>
      <span className="truncate text-base font-semibold">{appointment.serviceType.name}</span>
      <span className="flex min-w-0 items-center gap-2 text-xs">
        <PlateChip registration={appointment.registration} />
        <span className="min-w-0 truncate font-mono tracking-wide text-muted-foreground">{appointment.vin}</span>
      </span>
      <span className="flex min-w-0 items-center justify-between gap-2">
        <StatusBadge status={appointment.status} />
        <span className="truncate text-xs text-muted-foreground">{appointment.customerName}</span>
      </span>
    </button>
  )
}
