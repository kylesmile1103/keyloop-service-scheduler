// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/dashboard/components/section-cards.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { useQuery } from "@tanstack/react-query"
import { Ban, CalendarClock, ClipboardList, Gauge } from "lucide-react"
import type { ReactNode } from "react"

import { getAvailabilityOptions, getServiceTypesOptions } from "@/api/@tanstack/react-query.gen"
import type { AppointmentListItemResponse, AppointmentStatus, DealershipResponse, WorkshopScheduleResponse } from "@/api/types.gen"
import { scheduleKpis } from "@/app/dispatch/lib/schedule"
import { boardStatuses, statusMeta } from "@/app/dispatch/lib/status"
import { NO_FIGURE, ShareMeter, StatCard } from "@/components/stat-card"
import { formatDay, weekdayOf } from "@/lib/calendar-date"
import { formatLocalTime } from "@/lib/local-time"
import { nextOpenDate, openingHoursOn } from "@/lib/opening-hours"
import { cn } from "@/lib/utils"

import { cancellationsLastWeek, todayByStatus } from "../lib/overview"

const KPI_SERVICE_CODE = "INTERIM-SERVICE"

interface OverviewCardsProps {
  dealership: DealershipResponse
  today: string
  now: Date
  appointments: readonly AppointmentListItemResponse[] | undefined
  rangeFailed: boolean
  schedule: WorkshopScheduleResponse | undefined
  scheduleFailed: boolean
}

/** Summary KPI cards for the dealership overview page. */
export function OverviewCards({ dealership, today, now, appointments, rangeFailed, schedule, scheduleFailed }: OverviewCardsProps) {
  const byStatus = appointments ? todayByStatus(appointments, today) : undefined
  const week = appointments ? cancellationsLastWeek(appointments, today) : undefined
  const utilisation = schedule ? scheduleKpis(schedule, now).utilisation : undefined
  const fromRange = (value: string | undefined) => value ?? (rangeFailed ? NO_FIGURE : undefined)
  const unavailable = (failed: boolean, footer: ReactNode) => footer ?? (failed ? "Unavailable" : undefined)

  return (
    <section aria-label="Today" className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
      <StatCard
        label="Booked today"
        icon={ClipboardList}
        value={fromRange(byStatus && String(byStatus.total))}
        meter={byStatus && byStatus.total > 0 ? <StatusMeter counts={byStatus.counts} /> : undefined}
        footer={unavailable(rangeFailed, byStatus && todayFooter(byStatus.counts, byStatus.cancelled))}
        detail="Today, by status"
      />
      <StatCard
        label="Bay utilisation today"
        icon={Gauge}
        value={
          schedule
            ? utilisation && utilisation.capacityMinutes > 0
              ? `${Math.round((utilisation.bookedMinutes / utilisation.capacityMinutes) * 100)}%`
              : NO_FIGURE
            : scheduleFailed
              ? NO_FIGURE
              : undefined
        }
        meter={utilisation && utilisation.capacityMinutes > 0 ? <ShareMeter share={utilisation.bookedMinutes / utilisation.capacityMinutes} /> : undefined}
        footer={unavailable(
          scheduleFailed,
          schedule &&
            (utilisation
              ? `${hours(utilisation.bookedMinutes)} booked of ${hours(utilisation.capacityMinutes)} across ${plural(schedule.bays.filter((bay) => bay.isActive).length, "bay")}`
              : "Closed today")
        )}
        detail="Booked time over open bay time"
      />
      <StatCard
        label="Cancelled, last 7 days"
        icon={Ban}
        tile={statusMeta.Cancelled.classes.tile}
        value={fromRange(week && String(week.cancelled))}
        footer={unavailable(rangeFailed, week && (week.due === 0 ? "Nothing was due" : `${week.cancelled === 0 ? "None" : week.cancelled} of ${plural(week.due, "appointment")} due`))}
        detail="Due today or on the 6 days before"
      />
      <NextFreeStart dealership={dealership} today={today} now={now} />
    </section>
  )
}

function todayFooter(counts: ReadonlyMap<AppointmentStatus, number>, cancelled: number): string {
  const parts = boardStatuses.filter((status) => counts.has(status)).map((status) => `${counts.get(status)} ${statusMeta[status].label.toLowerCase()}`)
  const summary = parts.length > 0 ? parts.join(", ") : "Nothing booked"
  return cancelled > 0 ? `${summary}; ${cancelled} cancelled not counted` : summary
}

function StatusMeter({ counts }: { counts: ReadonlyMap<AppointmentStatus, number> }) {
  return (
    <span aria-hidden="true" className="mb-1 flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full">
      {boardStatuses
        .filter((status) => counts.has(status))
        .map((status) => (
          <span key={status} className={cn("h-full rounded-full", statusMeta[status].classes.dot)} style={{ flexGrow: counts.get(status) }} />
        ))}
    </span>
  )
}

function NextFreeStart({ dealership, today, now }: { dealership: DealershipResponse; today: string; now: Date }) {
  const dealershipId = dealership.id
  const timeZone = dealership.timeZoneId
  const serviceTypes = useQuery(getServiceTypesOptions({ path: { dealershipId } }))
  const service =
    serviceTypes.data?.find((candidate) => candidate.code === KPI_SERVICE_CODE && candidate.bookable) ??
    serviceTypes.data?.find((candidate) => candidate.bookable)
  const openToday = openingHoursOn(dealership, weekdayOf(today)) !== null
  const todayRead = useQuery({
    ...getAvailabilityOptions({ path: { dealershipId }, query: { serviceTypeId: service?.id ?? "", date: today } }),
    enabled: Boolean(service) && openToday,
  })
  const todaySlot = todayRead.data?.slots.find((slot) => Date.parse(slot.startUtc) >= now.getTime())
  const nextDay = nextOpenDate(dealership, today)
  const needNextDay = Boolean(service) && (!openToday || (todayRead.data !== undefined && !todaySlot))
  const nextRead = useQuery({
    ...getAvailabilityOptions({ path: { dealershipId }, query: { serviceTypeId: service?.id ?? "", date: nextDay ?? "" } }),
    enabled: needNextDay && nextDay !== null,
  })
  const nextSlot = nextRead.data?.slots[0]

  let value: string | undefined
  let footer: ReactNode
  const free = (slot: { freeBays: number; freeTechnicians: number }) => `${plural(slot.freeBays, "bay")} and ${plural(slot.freeTechnicians, "technician")} free`
  if (serviceTypes.isError || todayRead.isError || nextRead.isError) [value, footer] = [NO_FIGURE, "Couldn’t check availability"]
  else if (serviceTypes.data && !service) [value, footer] = [NO_FIGURE, "No bookable services"]
  else if (todaySlot) [value, footer] = [formatLocalTime(todaySlot.startUtc, timeZone), `Today, ${free(todaySlot)}`]
  else if (needNextDay && nextDay === null) [value, footer] = ["None", "The workshop has no opening hours"]
  else if (nextSlot && nextDay) [value, footer] = [`${formatDay(nextDay, "short").slice(0, 3)} ${formatLocalTime(nextSlot.startUtc, timeZone)}`, `${formatDay(nextDay, "long").replace(/ \d{4}$/, "")}, ${free(nextSlot)}`]
  else if (nextRead.data && nextDay)
    [value, footer] = ["None", `${openToday ? "No free start left today" : "Closed today"}, none on ${formatDay(nextDay, "long").replace(/ \d{4}$/, "")}`]

  return (
    <StatCard
      label="Next free start"
      icon={CalendarClock}
      value={value}
      footer={footer}
      detail={service ? `${service.name}, ${service.durationMinutes} min` : "Interim Service"}
    />
  )
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`

const hours = (minutes: number) => `${Number((minutes / 60).toFixed(1))} h`
