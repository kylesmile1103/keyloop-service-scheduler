import type { AppointmentListItemResponse, AppointmentStatus, DealershipResponse } from "@/api/types.gen"
import { activeStatuses } from "@/app/dispatch/lib/status"
import { byLocalDate, datesFrom, localDateOf } from "@/lib/appointment-range"
import { formatDay, shiftDate, weekdayOf } from "@/lib/calendar-date"
import { openingHoursOn } from "@/lib/opening-hours"

/** Days either side of today. */
export const OVERVIEW_DAYS_AROUND = 14

/** Total local dates in the overview window. */
export const OVERVIEW_DAYS = OVERVIEW_DAYS_AROUND * 2 + 1

/** Inclusive date range (`yyyy-MM-dd`) around `today`. */
export function overviewWindow(today: string): { from: string; to: string } {
  return { from: shiftDate(today, -OVERVIEW_DAYS_AROUND), to: shiftDate(today, OVERVIEW_DAYS_AROUND) }
}

const booked = (appointment: Pick<AppointmentListItemResponse, "status">) => appointment.status !== "Cancelled"

export interface DayCount {
  date: string
  count: number
  closed: boolean
  when: "past" | "today" | "future"
}

/** Daily booking counts across the overview window, excluding cancelled appointments. */
export function bookingsPerDay(appointments: readonly AppointmentListItemResponse[], dealership: DealershipResponse, today: string): DayCount[] {
  const { from, to } = overviewWindow(today)
  const days = byLocalDate(appointments.filter(booked))
  return datesFrom(from, to).map((date) => ({
    date,
    count: days.get(date)?.length ?? 0,
    closed: openingHoursOn(dealership, weekdayOf(date)) === null,
    when: date < today ? "past" : date === today ? "today" : "future",
  }))
}

export interface BookingsSummary {
  past: number
  today: number
  ahead: number
  total: number
  busiest: DayCount | null
  peak: number
}

export function bookingsSummary(days: readonly DayCount[]): BookingsSummary {
  const sum = (when: DayCount["when"]) => days.filter((day) => day.when === when).reduce((total, day) => total + day.count, 0)
  const busiest = days.reduce<DayCount | null>((best, day) => (day.count > (best?.count ?? 0) ? day : best), null)
  const [past, today, ahead] = [sum("past"), sum("today"), sum("future")]
  return { past, today, ahead, total: past + today + ahead, busiest, peak: busiest?.count ?? 0 }
}

/** Groups consecutive day indices, splitting at closed days with zero bookings. */
export function lineRuns(days: readonly DayCount[]): number[][] {
  const runs: number[][] = []
  let run: number[] = []
  days.forEach((day, index) => {
    if (day.closed && day.count === 0) {
      if (run.length > 0) runs.push(run)
      run = []
    } else run.push(index)
  })
  if (run.length > 0) runs.push(run)
  return runs
}

/** Accessible text summary of the daily bookings chart. */
export function chartSummary(summary: BookingsSummary): string {
  const sentence = `${summary.past} in the last ${OVERVIEW_DAYS_AROUND} days, ${summary.today} today and ${summary.ahead} booked so far for the next ${OVERVIEW_DAYS_AROUND}.`
  const busiest = summary.busiest && formatDay(summary.busiest.date, "long").replace(/ \d{4}$/, "")
  return summary.busiest ? `${sentence} Busiest: ${busiest}, with ${summary.busiest.count}.` : sentence
}

export interface ServiceShare {
  id: string
  name: string
  count: number
  share: number
}

export interface ServiceMix {
  services: ServiceShare[]
  other: { count: number; services: number; share: number } | null
  total: number
}

/** Aggregates non-cancelled bookings by service type over the window. */
export function serviceMix(appointments: readonly AppointmentListItemResponse[], limit = 5): ServiceMix {
  const counts = new Map<string, { name: string; count: number }>()
  for (const appointment of appointments.filter(booked)) {
    const entry = counts.get(appointment.serviceType.id) ?? { name: appointment.serviceType.name, count: 0 }
    entry.count++
    counts.set(appointment.serviceType.id, entry)
  }
  const total = [...counts.values()].reduce((sum, entry) => sum + entry.count, 0)
  const ranked = [...counts.entries()]
    .map(([id, { name, count }]) => ({ id, name, count, share: total > 0 ? count / total : 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  const shown = ranked.length > limit + 1 ? ranked.slice(0, limit) : ranked
  const rest = ranked.slice(shown.length)
  const otherCount = rest.reduce((sum, entry) => sum + entry.count, 0)
  return {
    services: shown,
    other: rest.length > 0 ? { count: otherCount, services: rest.length, share: total > 0 ? otherCount / total : 0 } : null,
    total,
  }
}

export const UPCOMING_LIMIT = 6

/** Active appointments that have not ended by `now`, ordered by start time. */
export function upcomingAppointments(appointments: readonly AppointmentListItemResponse[], now: Date, limit = UPCOMING_LIMIT): AppointmentListItemResponse[] {
  const instant = now.getTime()
  return appointments
    .filter((appointment) => activeStatuses.includes(appointment.status) && Date.parse(appointment.endUtc) > instant)
    .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc) || a.id.localeCompare(b.id))
    .slice(0, limit)
}

export interface TodayByStatus {
  total: number
  counts: Map<AppointmentStatus, number>
  cancelled: number
}

/** Counts today's appointments on the dealership's calendar by status. */
export function todayByStatus(appointments: readonly AppointmentListItemResponse[], today: string): TodayByStatus {
  const counts = new Map<AppointmentStatus, number>()
  let cancelled = 0
  for (const appointment of appointments) {
    if (localDateOf(appointment) !== today) continue
    if (!booked(appointment)) cancelled++
    else counts.set(appointment.status, (counts.get(appointment.status) ?? 0) + 1)
  }
  return { total: [...counts.values()].reduce((sum, count) => sum + count, 0), counts, cancelled }
}

/** Counts cancelled appointments due in the 7-day window ending on `today`. */
export function cancellationsLastWeek(appointments: readonly AppointmentListItemResponse[], today: string) {
  const from = shiftDate(today, -6)
  const due = appointments.filter((appointment) => {
    const date = localDateOf(appointment)
    return date >= from && date <= today
  })
  return { from, to: today, cancelled: due.filter((appointment) => !booked(appointment)).length, due: due.length }
}
