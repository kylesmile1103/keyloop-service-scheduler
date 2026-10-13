import { useQuery } from "@tanstack/react-query"
import { CalendarCheck2, ShieldAlert } from "lucide-react"
import { useId } from "react"

import type { AppointmentListItemResponse, DealershipResponse } from "@/api/types.gen"
import { ProblemAlert } from "@/components/problem-alert"
import { Skeleton } from "@/components/ui/skeleton"
import { useQueryFailure } from "@/hooks/use-query-failure"
import { localDateOf, MAX_RANGE_DAYS, rangeReadOptions } from "@/lib/appointment-range"
import { formatDay, shiftDate } from "@/lib/calendar-date"
import { cn } from "@/lib/utils"

/** The statuses that still hold a bay and a technician: the ones the API flags (Task 30a). */
const HOLDING = new Set<AppointmentListItemResponse["status"]>(["Confirmed", "CheckedIn", "InProgress"])

/** How many appointments the preview lists before "and n more". */
const LISTED = 5

interface UpcomingWorkProps {
  dealership: DealershipResponse
  today: string
  /** Whose work: a technician's or a bay's, by id and name. */
  resource: { kind: "technician" | "bay"; id: string; name: string }
  className?: string
}

const dayWords = (date: string) => formatDay(date, "long").replace(/ \d{4}$/, "")
const time = (local: string) => local.slice(11, 16)

/**
 * What deactivating a technician or taking a bay out of service would flag (UI_DESIGN 11.24): the appointments from today
 * to the longest range the API reads (62 days) that still hold the resource, read with the range read the Overview and the
 * Calendar use. Each would gain a competence warning on the board; none is moved. Up to five are listed by day, time and
 * service, with the count of the rest; a failed read says so and does not stop the change.
 */
export function UpcomingWork({ dealership, today, resource, className }: UpcomingWorkProps) {
  const headingId = useId()
  const last = shiftDate(today, MAX_RANGE_DAYS - 1)
  const options = rangeReadOptions(dealership.id, today, last)
  const range = useQuery(options)
  const failure = useQueryFailure(range, options.queryKey)

  if (!range.data && failure !== null) {
    return (
      <ProblemAlert
        title="Couldn’t check the upcoming appointments"
        error={failure}
        onRetry={() => void range.refetch()}
        retrying={range.isFetching}
        className={className}
      />
    )
  }
  if (!range.data) {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <p role="status" className="sr-only">
          Checking the upcoming appointments…
        </p>
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
    )
  }

  const held = range.data.filter(
    (appointment) => HOLDING.has(appointment.status) && (resource.kind === "technician" ? appointment.technician.id : appointment.bay.id) === resource.id
  )
  if (held.length === 0) {
    return (
      <p className={cn("flex items-start gap-2 text-sm text-pretty text-muted-foreground", className)}>
        <CalendarCheck2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {`No appointments from today to ${dayWords(last)} hold ${resource.name}, so none would be flagged.`}
      </p>
    )
  }

  const count = held.length === 1 ? "1 upcoming appointment would" : `${held.length} upcoming appointments would`
  return (
    <section aria-labelledby={headingId} className={cn("flex flex-col gap-2 rounded-xl border border-warning/30 bg-warning-subtle p-3 text-sm", className)}>
      <h4 id={headingId} className="flex items-center gap-2 font-semibold text-warning">
        <ShieldAlert aria-hidden="true" className="size-4 shrink-0" />
        {`${count} be flagged for review`}
      </h4>
      <ul className="flex flex-col gap-1.5">
        {held.slice(0, LISTED).map((appointment) => (
          <li key={appointment.id} className="flex min-w-0 flex-col">
            <span className="font-medium tabular-nums">{`${dayWords(localDateOf(appointment))}, ${time(appointment.startLocal)}–${time(appointment.endLocal)}`}</span>
            <span className="truncate text-muted-foreground">
              {`${appointment.serviceType.name}, ${resource.kind === "technician" ? appointment.bay.name : appointment.technician.name}`}
            </span>
          </li>
        ))}
      </ul>
      {held.length > LISTED && <p className="text-muted-foreground">{`and ${held.length - LISTED} more until ${dayWords(last)}`}</p>}
      <p className="text-pretty text-muted-foreground">
        {`They keep ${resource.name}: the board marks them Review until someone reassigns or rebooks them.`}
      </p>
    </section>
  )
}
