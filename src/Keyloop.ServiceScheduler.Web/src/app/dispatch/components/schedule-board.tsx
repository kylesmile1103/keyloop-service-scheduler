import type { UseQueryResult } from "@tanstack/react-query"
import { ChevronRight, EyeOff, RefreshCw, RotateCw, Warehouse } from "lucide-react"
import { type ReactNode, type Ref, useId } from "react"

import type { DealershipResponse, GetWorkshopScheduleError, OperatingWindowResponse, WorkshopScheduleResponse } from "@/api/types.gen"
import { IllustratedState } from "@/components/illustrated-state"
import { TraceIdRow } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDay, weekdayOf } from "@/lib/calendar-date"
import { formatLocalTime } from "@/lib/local-time"
import { daySentence, hourMarks, nextOpenDate, openingHoursOn } from "@/lib/opening-hours"
import { describeFailure, failureKey } from "@/lib/problem-details"
import { cn } from "@/lib/utils"

import type { BoardAppointment, Lane, LaneMode } from "../lib/schedule"
import { BoardMessage, BoardPanel, BoardPlaceholder } from "./board-placeholder"
import { ScheduleAgenda } from "./schedule-agenda"
import { StatusLegend } from "./status-legend"
import { TimelineGrid } from "./timeline-grid"

interface ScheduleBoardProps {
  /** The board's container, focused when the sheet closes after its block is gone. */
  ref?: Ref<HTMLDivElement>
  dealership: DealershipResponse
  date: string
  today: string
  mode: LaneMode
  schedule: UseQueryResult<WorkshopScheduleResponse, GetWorkshopScheduleError>
  /** The schedule's failure, kept while the day is read again (`useQueryFailure`), so Try again stays; `null` otherwise. */
  failure: GetWorkshopScheduleError | null
  /** The lanes of this view that the lane filter leaves showing. */
  lanes: readonly Lane[]
  /** How many lanes the view has before filtering. */
  laneCount: number
  onShowAllLanes: () => void
  onDateChange: (date: string | null) => void
  /** The phone presentation: an agenda instead of the timeline. */
  agenda: boolean
  now: Date
  selectedId: string | null
  /** A booking just made, whose block or card draws the booked halo. */
  bookedId?: string | null
  /** The empty day's one action (Book appointment, once booking is wired). */
  emptyAction?: ReactNode
  onSelect: (appointment: BoardAppointment, element: HTMLElement) => void
}

/** The whole local hours a window covers, as the timeline draws them ("08:00" … "17:00"). */
function windowHours(window: OperatingWindowResponse): string[] {
  return hourMarks({ opensAt: window.opensAtLocal.slice(11, 16), closesAt: window.closesAtLocal.slice(11, 16) })
}

/**
 * The selected dealership's day: a heading with the opening hours in its own zone, then the timeline (or, on a phone, the
 * agenda), with loading, failure, closed-day and hidden-lane states, and the status legend underneath.
 */
export function ScheduleBoard({
  ref,
  dealership,
  date,
  today,
  mode,
  schedule,
  failure,
  lanes,
  laneCount,
  onShowAllLanes,
  onDateChange,
  agenda,
  now,
  selectedId,
  bookedId = null,
  emptyAction,
  onSelect,
}: ScheduleBoardProps) {
  const headingId = useId()
  const data = schedule.data
  const isToday = date === today
  const appointments = lanes.reduce((total, lane) => total + lane.appointments.length, 0)
  const laneLabel = mode === "bays" ? "Bay" : "Technician"

  const weekly = openingHoursOn(dealership, weekdayOf(date))
  const hours = data?.operatingWindow ? windowHours(data.operatingWindow) : weekly ? hourMarks(weekly) : undefined
  const dayName = (day: string) => formatDay(day, "long").replace(/ \d{4}$/, "")

  let body: ReactNode
  if (!data && failure !== null) {
    const { summary, traceId } = describeFailure(failure)
    body = (
      <IllustratedState
        role="alert"
        illustration="error-connection"
        title="Couldn’t load the schedule"
        action={
          // It stays while the day is read again, disabled but focused, ready for another try if that one fails too.
          <Button type="button" onClick={() => void schedule.refetch()} disabled={schedule.isFetching} focusableWhenDisabled>
            <RotateCw aria-hidden="true" className={cn(schedule.isFetching && "animate-spin")} />
            Try again
          </Button>
        }
        className="px-4"
      >
        <p key={failureKey(failure)} className="wrap-break-word">
          {summary}
        </p>
        {traceId && <TraceIdRow traceId={traceId} className="max-w-full" />}
      </IllustratedState>
    )
  } else if (!data) {
    body = (
      <>
        <p role="status" className="sr-only">
          Loading the schedule…
        </p>
        {agenda ? <AgendaSkeleton /> : <BoardPlaceholder framed={false} loading laneLabel={laneLabel} hours={hours} />}
      </>
    )
  } else if (data.operatingWindow === null) {
    const next = nextOpenDate(dealership, date)
    const message = (
      <IllustratedState
        illustration="closed-day"
        title={isToday ? "Closed today" : `Closed on ${dayName(date)}`}
        action={
          next && (
            <Button type="button" variant="signal" className="cursor-pointer" onClick={() => onDateChange(next)}>
              {`Go to ${dayName(next)}`}
              <ChevronRight aria-hidden="true" className="transition-transform duration-150 group-hover/button:translate-x-0.5" />
            </Button>
          )
        }
      >
        <p>{next ? `The workshop opens again on ${dayName(next)}.` : "The workshop does not open that day, so nothing can be booked."}</p>
      </IllustratedState>
    )
    body = agenda ? (
      message
    ) : (
      <BoardPlaceholder framed={false} closed laneLabel={laneLabel} hours={weekly ? hourMarks(weekly) : undefined}>
        <BoardPanel>{message}</BoardPanel>
      </BoardPlaceholder>
    )
  } else if (laneCount === 0) {
    body = (
      <div className="flex justify-center p-6">
        <BoardMessage icon={Warehouse} level={3} title={mode === "bays" ? "No bays yet" : "No technicians yet"}>
          <p>{mode === "bays" ? "This dealership has no service bays to schedule." : "This dealership has no technicians on its roster."}</p>
        </BoardMessage>
      </div>
    )
  } else if (lanes.length === 0) {
    body = (
      <div className="flex justify-center p-6">
        <BoardMessage
          icon={EyeOff}
          level={3}
          title="Every lane is hidden"
          action={
            <Button type="button" variant="outline" className="cursor-pointer" onClick={onShowAllLanes}>
              Show all lanes
            </Button>
          }
        >
          <p>The lane filter leaves nothing to show.</p>
        </BoardMessage>
      </div>
    )
  } else if (appointments === 0) {
    const message = (
      <IllustratedState
        illustration="empty-schedule"
        title={isToday ? "No appointments today" : `No appointments on ${dayName(date)}`}
        action={emptyAction}
      >
        <p>{mode === "bays" ? "Every bay is free all day." : "Every technician is free all day."}</p>
      </IllustratedState>
    )
    // On a phone the message replaces a list of empty lanes; on wider screens it follows the real, empty timeline, which
    // still shows the day's hours, closed time and now line.
    body = agenda ? (
      message
    ) : (
      <>
        <TimelineGrid
          lanes={lanes}
          mode={mode}
          operatingWindow={data.operatingWindow}
          granularityMinutes={data.slotGranularityMinutes}
          timeZone={dealership.timeZoneId}
          now={now}
          selectedId={selectedId}
          onSelect={onSelect}
        />
        <div className="border-t">{message}</div>
      </>
    )
  } else if (agenda) {
    body = (
      <ScheduleAgenda
        lanes={lanes}
        mode={mode}
        timeZone={dealership.timeZoneId}
        now={isToday ? now : null}
        selectedId={selectedId}
        bookedId={bookedId}
        onSelect={onSelect}
      />
    )
  } else {
    body = (
      <TimelineGrid
        lanes={lanes}
        mode={mode}
        operatingWindow={data.operatingWindow}
        granularityMinutes={data.slotGranularityMinutes}
        timeZone={dealership.timeZoneId}
        now={now}
        selectedId={selectedId}
        bookedId={bookedId}
        onSelect={onSelect}
      />
    )
  }

  const header = (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-1", agenda ? "px-1" : "border-b px-4 py-3")}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 id={headingId} className="truncate font-heading text-lg font-semibold">
          {dealership.name}
        </h2>
        <p className="text-sm text-muted-foreground tabular-nums">{daySentence(dealership, date, today, data)}</p>
      </div>
      {data && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
          <RefreshCw aria-hidden="true" className={cn("size-3", schedule.isFetching && "animate-spin")} />
          {`Updated ${formatLocalTime(new Date(schedule.dataUpdatedAt).toISOString(), dealership.timeZoneId)}`}
        </p>
      )}
    </div>
  )

  if (agenda) {
    return (
      <section ref={ref} tabIndex={-1} aria-labelledby={headingId} className="flex flex-col gap-3 outline-none">
        {header}
        {body}
      </section>
    )
  }

  return (
    <Card ref={ref} tabIndex={-1} role="region" aria-labelledby={headingId} className="gap-0 py-0 outline-none">
      {header}
      {body}
      {data?.operatingWindow && lanes.length > 0 && (
        <div className="border-t px-4 py-2.5">
          <StatusLegend />
        </div>
      )}
    </Card>
  )
}

/** Agenda-shaped loading state: two lanes of card-shaped bars. */
function AgendaSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      {[0, 1].map((lane) => (
        <div key={lane} className="flex flex-col gap-2 rounded-xl bg-muted/40 p-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      ))}
    </div>
  )
}
