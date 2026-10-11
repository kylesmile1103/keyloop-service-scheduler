import type { UseQueryResult } from "@tanstack/react-query"
import { CalendarArrowUp, CalendarOff, EyeOff, RefreshCw, Warehouse } from "lucide-react"
import { type ReactNode, type Ref, useId } from "react"

import type { DealershipResponse, GetWorkshopScheduleError, WorkshopScheduleResponse } from "@/api/types.gen"
import { ProblemAlert } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

import { formatDay, weekdayOf } from "../lib/calendar-date"
import { hourMarks, nextOpenDate, openingHoursOn } from "../lib/opening-hours"
import type { BoardAppointment, Lane, LaneMode } from "../lib/schedule"
import { formatLocalTime } from "../lib/time-grid"
import { BoardMessage, BoardPlaceholder } from "./board-placeholder"
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
  onSelect: (appointment: BoardAppointment, element: HTMLElement) => void
}

/** Phones and touch screens get 44 px targets (task 16 mobile addendum). */
const touch = "max-md:h-11 pointer-coarse:h-11"

/** "Open today 08:00–18:00 (Europe/London).", from the schedule's window once it arrives, the weekly hours until then. */
function daySentence(dealership: DealershipResponse, date: string, today: string, schedule: WorkshopScheduleResponse | undefined) {
  const window = schedule?.operatingWindow
  const weekly = openingHoursOn(dealership, weekdayOf(date))
  const hours =
    schedule === undefined
      ? weekly && `${weekly.opensAt}–${weekly.closesAt}`
      : window && `${window.opensAtLocal.slice(11, 16)}–${window.closesAtLocal.slice(11, 16)}`
  const zone = `(${dealership.timeZoneId}).`
  if (date === today) return hours ? `Open today ${hours} ${zone}` : `Closed today ${zone}`
  const day = formatDay(date, "long")
  return hours ? `Open ${hours} on ${day} ${zone}` : `Closed on ${day} ${zone}`
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
  lanes,
  laneCount,
  onShowAllLanes,
  onDateChange,
  agenda,
  now,
  selectedId,
  onSelect,
}: ScheduleBoardProps) {
  const headingId = useId()
  const data = schedule.data
  const isToday = date === today
  const appointments = lanes.reduce((total, lane) => total + lane.appointments.length, 0)
  const laneLabel = mode === "bays" ? "Bay" : "Technician"

  let body: ReactNode
  if (!data && schedule.isError) {
    body = (
      <div className="p-4">
        <ProblemAlert
          title="Couldn’t load the schedule"
          error={schedule.error}
          onRetry={() => void schedule.refetch()}
          retrying={schedule.isFetching}
          className="max-w-xl"
        />
      </div>
    )
  } else if (!data) {
    const weekly = openingHoursOn(dealership, weekdayOf(date))
    body = (
      <>
        <p role="status" className="sr-only">
          Loading the schedule…
        </p>
        {agenda ? (
          <AgendaSkeleton />
        ) : (
          <BoardPlaceholder framed={false} loading laneLabel={laneLabel} hours={weekly ? hourMarks(weekly) : undefined} />
        )}
      </>
    )
  } else if (data.operatingWindow === null) {
    const next = nextOpenDate(dealership, date)
    const message = (
      <BoardMessage
        icon={CalendarOff}
        level={3}
        title={isToday ? "Closed today" : `Closed on ${formatDay(date, "long").replace(/ \d{4}$/, "")}`}
        action={
          next && (
            <Button type="button" variant="outline" className={cn("cursor-pointer", touch)} onClick={() => onDateChange(next)}>
              <CalendarArrowUp aria-hidden="true" />
              {`Go to ${formatDay(next, "long").replace(/ \d{4}$/, "")}`}
            </Button>
          )
        }
      >
        <p>The workshop does not open that day, so nothing can be booked.</p>
      </BoardMessage>
    )
    body = agenda ? (
      <div className="flex justify-center rounded-xl bg-muted/40 p-4">{message}</div>
    ) : (
      <BoardPlaceholder framed={false} closed laneLabel={laneLabel}>
        {message}
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
            <Button type="button" variant="outline" className={cn("cursor-pointer", touch)} onClick={onShowAllLanes}>
              Show all lanes
            </Button>
          }
        >
          <p>The lane filter leaves nothing to show.</p>
        </BoardMessage>
      </div>
    )
  } else if (agenda) {
    body = (
      <ScheduleAgenda
        lanes={lanes}
        mode={mode}
        timeZone={dealership.timeZoneId}
        now={isToday ? now : null}
        selectedId={selectedId}
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
        onSelect={onSelect}
      />
    )
  }

  const header = (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-1", agenda ? "px-1" : "border-b px-4 py-3")}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 id={headingId} className="truncate text-base font-semibold">
          {dealership.name}
        </h2>
        <p className="text-sm text-muted-foreground tabular-nums">
          {daySentence(dealership, date, today, data)}
          {data?.operatingWindow && appointments === 0 && <span>{" Nothing booked yet."}</span>}
        </p>
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
