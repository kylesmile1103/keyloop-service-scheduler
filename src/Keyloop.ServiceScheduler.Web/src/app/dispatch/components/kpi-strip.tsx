// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/dashboard/components/section-cards.tsx` and
// `src/app/dashboard-2/components/metrics-overview.tsx`, Copyright (c) 2025 ShadcnStore, MIT License.
import { useQuery } from "@tanstack/react-query"
import type { LucideIcon } from "lucide-react"
import { CalendarClock, ClipboardList, Gauge, UsersRound } from "lucide-react"
import { useId, type ReactNode } from "react"

import { getAvailabilityOptions, getServiceTypesOptions } from "@/api/@tanstack/react-query.gen"
import type { AppointmentStatus, WorkshopScheduleResponse } from "@/api/types.gen"
import { Card, CardAction, CardDescription, CardFooter, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDay } from "@/lib/calendar-date"
import { formatLocalTime } from "@/lib/local-time"
import { fieldErrors, parseProblem } from "@/lib/problem-details"

import { boardAppointments, scheduleKpis } from "../lib/schedule"
import { boardStatuses, statusMeta } from "../lib/status"

/** Displayed when a KPI card has no figure for the day. */
const NO_FIGURE = "–"

/** Default service code for the next-free-slot KPI; falls back to the first bookable service. */
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
 * Day summary strip showing appointments count, bay utilisation, technicians busy now, and next free slot.
 */
export function KpiStrip({ dealershipId, date, today, timeZone, schedule, failed, now, refetchInterval }: KpiStripProps) {
  const kpis = schedule ? scheduleKpis(schedule, now) : undefined
  const isToday = date === today
  const closed = schedule ? schedule.operatingWindow === null : false
  const dayWords = isToday ? "Today" : formatDay(date, "long")

  return (
    <section aria-label="Day summary" className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
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
        meter={kpis?.utilisation && kpis.utilisation.capacityMinutes > 0 ? kpis.utilisation.bookedMinutes / kpis.utilisation.capacityMinutes : undefined}
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
        now={now}
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
  /** A share from 0 to 1, drawn as a thin meter under the figure (bay utilisation). */
  meter?: number
  failed: boolean
  footer: ReactNode
  detail: ReactNode
}

/** Single KPI card displaying a metric label, figure, optional progress meter, and context footer. */
function KpiCard({ label, icon: Icon, value, meter, failed, footer, detail }: KpiCardProps) {
  const labelId = useId()
  const loading = value === undefined && !failed

  return (
    <Card size="sm" role="group" aria-labelledby={labelId} aria-busy={loading || undefined} className="@container/card shadow-xs">
      <CardHeader>
        <CardDescription id={labelId}>{label}</CardDescription>
        <div className="font-heading text-2xl font-bold tracking-tight tabular-nums md:text-3xl">
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
        </div>
        <CardAction>
          <span className="flex size-9 items-center justify-center rounded-chip bg-secondary text-secondary-foreground max-md:size-8">
            <Icon aria-hidden="true" className="size-5 max-md:size-4" />
          </span>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 border-t-0 bg-transparent pt-0">
        {meter !== undefined && (
          <span aria-hidden="true" className="mb-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-chart-1" style={{ width: `${Math.min(Math.max(meter, 0), 1) * 100}%` }} />
          </span>
        )}
        {loading ? (
          <Skeleton className="h-4 w-3/4" />
        ) : (
          <div className="line-clamp-2 text-xs text-pretty text-muted-foreground">{failed && !footer ? "Unavailable" : footer}</div>
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
  /** Starts before this instant have passed, even while the last availability read still lists them. */
  now: Date
  refetchInterval: number | false
}

/** The earliest bookable start for an interim service that day: the next one from now on today's board. */
function NextFreeSlot({ dealershipId, date, today, timeZone, schedule, failed, now, refetchInterval }: NextFreeSlotProps) {
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
    ;[value, footer] = [NO_FIGURE, (problem && fieldErrors(problem, { date: "Date" }).date) || "Couldn’t check availability"]
  } else if (serviceTypes.data && !service) [value, footer] = [NO_FIGURE, "No bookable services"]
  else if (availability.data && service) {
    // The API leaves out starts that have passed when it answers; between reads (auto-refresh off, no window focus) the
    // answer ages, so a start already behind `now` is skipped here too. Later days' starts are all ahead of now.
    const slot = availability.data.slots.find((candidate) => Date.parse(candidate.startUtc) >= now.getTime())
    ;[value, footer] = slot
      ? [
          formatLocalTime(slot.startUtc, timeZone),
          `${plural(slot.freeBays, "bay")} and ${plural(slot.freeTechnicians, "technician")} free`,
        ]
      : ["None", date === today ? "No free start left today" : `${service.name} is fully booked`]
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

