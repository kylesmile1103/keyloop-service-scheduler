import { useQuery } from "@tanstack/react-query"
import type { LucideIcon } from "lucide-react"
import { CalendarClock, ClipboardList, Gauge, UsersRound } from "lucide-react"
import { useId, type ReactNode } from "react"

import { getAvailabilityOptions, getServiceTypesOptions } from "@/api/@tanstack/react-query.gen"
import type { AppointmentStatus, WorkshopScheduleResponse } from "@/api/types.gen"
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { fieldErrors, parseProblem } from "@/lib/problem-details"

import { formatDay } from "../lib/calendar-date"
import { boardAppointments, scheduleKpis } from "../lib/schedule"
import { boardStatuses, statusMeta } from "../lib/status"
import { formatLocalTime } from "../lib/time-grid"

/** What a card shows when it has no figure for the day (its footer says why); read out in words. */
const NO_FIGURE = "–"

/** The service whose next free slot the strip shows (Addendum B §B4); the first bookable one when a catalogue lacks it. */
const KPI_SERVICE_CODE = "INTERIM-SERVICE"

interface KpiStripProps {
  dealershipId: string
  /** The board's local date and today's, both `yyyy-MM-dd` in the dealership's calendar. */
  date: string
  today: string
  timeZone: string
  /** Undefined until the schedule arrives (skeletons), or when it failed (dashes). */
  schedule: WorkshopScheduleResponse | undefined
  failed: boolean
  now: Date
  /** The board's auto-refresh interval, applied to the availability read as well. */
  refetchInterval: number | false
}

/**
 * Four figures for the day, computed from the board's own data plus one availability read (adopted from the template's
 * dashboard `section-cards`): appointments, bay utilisation, technicians busy now, and the next free slot for an interim service.
 */
export function KpiStrip({ dealershipId, date, today, timeZone, schedule, failed, now, refetchInterval }: KpiStripProps) {
  const kpis = schedule ? scheduleKpis(schedule, now) : undefined
  const isToday = date === today
  const closed = schedule ? schedule.operatingWindow === null : false
  const dayWords = isToday ? "Today" : formatDay(date, "long")

  return (
    <section
      aria-label="Day summary"
      className="grid grid-cols-2 gap-3 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs md:gap-4 lg:grid-cols-4 dark:*:data-[slot=card]:bg-card"
    >
      <KpiCard
        label="Appointments"
        icon={ClipboardList}
        value={kpis ? String(kpis.appointments) : undefined}
        failed={failed}
        footer={kpis ? statusSummary(schedule!) : undefined}
        detail={dayWords}
      />
      <KpiCard
        label="Bay utilisation"
        icon={Gauge}
        value={kpis ? (kpis.utilisation ? percent(kpis.utilisation) : NO_FIGURE) : undefined}
        failed={failed}
        footer={
          kpis
            ? kpis.utilisation
              ? `${hours(kpis.utilisation.bookedMinutes)} booked of ${hours(kpis.utilisation.capacityMinutes)} across ${activeBays(schedule!)}`
              : "Closed that day"
            : undefined
        }
        detail="Booked time over open bay time"
      />
      <KpiCard
        label="Technicians busy now"
        icon={UsersRound}
        value={kpis ? (kpis.busyNow ? `${kpis.busyNow.busy} of ${kpis.busyNow.active}` : NO_FIGURE) : undefined}
        failed={failed}
        footer={
          kpis
            ? kpis.busyNow
              ? `${kpis.busyNow.busy === 0 ? "None" : "With a job"} under way at ${formatLocalTime(now.toISOString(), timeZone)}`
              : closed && isToday
                ? "Closed today"
                : "Shown for today only"
            : undefined
        }
        detail="Confirmed, checked in or in progress"
      />
      <NextFreeSlot
        dealershipId={dealershipId}
        date={date}
        today={today}
        timeZone={timeZone}
        schedule={schedule}
        failed={failed}
        refetchInterval={refetchInterval}
      />
    </section>
  )
}

interface KpiCardProps {
  label: string
  icon: LucideIcon
  /** `undefined` while loading. */
  value: string | undefined
  failed: boolean
  footer: ReactNode
  detail: ReactNode
}

function KpiCard({ label, icon: Icon, value, failed, footer, detail }: KpiCardProps) {
  const labelId = useId()
  const loading = value === undefined && !failed

  return (
    <Card role="group" aria-labelledby={labelId} aria-busy={loading || undefined} className="@container/card max-md:[--card-spacing:--spacing(3)]">
      <CardHeader>
        <CardDescription id={labelId}>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tracking-tight tabular-nums @[250px]/card:text-3xl">
          {loading ? (
            <Skeleton className="my-1 h-7 w-16" />
          ) : value === undefined || value === NO_FIGURE ? (
            <>
              <span aria-hidden="true">{NO_FIGURE}</span>
              <span className="sr-only">No figure</span>
            </>
          ) : (
            value
          )}
        </CardTitle>
        <CardAction>
          <span className="flex size-8 items-center justify-center rounded-lg border bg-background text-muted-foreground max-md:size-7">
            <Icon aria-hidden="true" className="size-4" />
          </span>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 border-t-0 bg-transparent pt-0 text-sm">
        {loading ? (
          <Skeleton className="h-4 w-3/4" />
        ) : (
          <div className="line-clamp-2 font-medium text-pretty">{failed && !footer ? "Unavailable" : footer}</div>
        )}
        <div className="line-clamp-1 text-xs text-muted-foreground max-md:hidden">{detail}</div>
      </CardFooter>
    </Card>
  )
}

interface NextFreeSlotProps {
  dealershipId: string
  date: string
  today: string
  timeZone: string
  schedule: WorkshopScheduleResponse | undefined
  failed: boolean
  refetchInterval: number | false
}

/** The earliest bookable start for an interim service that day: the next one from now on today's board. */
function NextFreeSlot({ dealershipId, date, today, timeZone, schedule, failed, refetchInterval }: NextFreeSlotProps) {
  const label = date === today ? "Next free slot" : "First free slot"
  const past = date < today
  const closed = schedule?.operatingWindow === null
  const serviceTypes = useQuery({ ...getServiceTypesOptions({ path: { dealershipId } }), enabled: !past })
  const service =
    serviceTypes.data?.find((candidate) => candidate.code === KPI_SERVICE_CODE && candidate.bookable) ??
    serviceTypes.data?.find((candidate) => candidate.bookable)
  const availability = useQuery({
    ...getAvailabilityOptions({ path: { dealershipId }, query: { serviceTypeId: service?.id ?? "", date } }),
    enabled: Boolean(service) && !past && schedule !== undefined && !closed,
    refetchInterval,
  })

  let value: string | undefined
  let footer: ReactNode
  if (past) [value, footer] = [NO_FIGURE, "Past days take no bookings"]
  else if (failed) [value, footer] = [NO_FIGURE, "Unavailable"]
  else if (closed) [value, footer] = [NO_FIGURE, "Closed that day"]
  else if (serviceTypes.isError || availability.isError) {
    const problem = parseProblem(availability.error ?? serviceTypes.error)
    ;[value, footer] = [NO_FIGURE, (problem && fieldErrors(problem).date) || "Couldn’t check availability"]
  } else if (serviceTypes.data && !service) [value, footer] = [NO_FIGURE, "No bookable services"]
  else if (availability.data && service) {
    const slot = availability.data.slots[0]
    ;[value, footer] = slot
      ? [
          formatLocalTime(slot.startUtc, timeZone),
          `${plural(slot.freeBays, "bay")} and ${plural(slot.freeTechnicians, "technician")} free`,
        ]
      : ["None", `${service.name} is fully booked`]
  }

  return (
    <KpiCard
      label={label}
      icon={CalendarClock}
      value={value}
      failed={false}
      footer={footer}
      detail={service ? `${service.name}, ${service.durationMinutes} min` : "Interim Service"}
    />
  )
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`

const percent = ({ bookedMinutes, capacityMinutes }: { bookedMinutes: number; capacityMinutes: number }) =>
  capacityMinutes > 0 ? `${Math.round((bookedMinutes / capacityMinutes) * 100)}%` : NO_FIGURE

/** 420 → "7 h", 375 → "6.3 h". */
const hours = (minutes: number) => `${Number((minutes / 60).toFixed(1))} h`

const activeBays = (schedule: WorkshopScheduleResponse) => plural(schedule.bays.filter((bay) => bay.isActive).length, "bay")

/** "4 confirmed, 1 in progress, 1 completed": the day's appointments by status, in lifecycle order. */
function statusSummary(schedule: WorkshopScheduleResponse): string {
  const counts = new Map<AppointmentStatus, number>()
  for (const appointment of boardAppointments(schedule)) counts.set(appointment.status, (counts.get(appointment.status) ?? 0) + 1)
  if (counts.size === 0) return "Nothing booked"
  return boardStatuses
    .filter((status) => counts.has(status))
    .map((status) => `${counts.get(status)} ${statusMeta[status].label.toLowerCase()}`)
    .join(", ")
}

