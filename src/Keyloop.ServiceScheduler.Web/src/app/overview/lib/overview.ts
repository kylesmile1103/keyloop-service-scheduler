import type { AppointmentListItemResponse, AppointmentStatus, DealershipResponse } from "@/api/types.gen"
import { activeStatuses } from "@/app/dispatch/lib/status"
import { byLocalDate, datesFrom, localDateOf } from "@/lib/appointment-range"
import { formatDay, shiftDate, weekdayOf } from "@/lib/calendar-date"
import { openingHoursOn } from "@/lib/opening-hours"

/**
 * The Overview's figures, computed from one range read: the 14 days before today, today and the 14 days after, in the
 * dealership's own calendar (`today` is `todayIn(dealership.timeZoneId)`, never the browser's day). A cancelled
 * appointment is not work, so it counts only towards the cancellations; every other status counts as a booking.
 */

/** Days either side of today. */
export const OVERVIEW_DAYS_AROUND = 14

/** How many local dates the Overview reads: the fortnight behind, today, the fortnight ahead. */
export const OVERVIEW_DAYS = OVERVIEW_DAYS_AROUND * 2 + 1

/** The range read's bounds for a day (`yyyy-MM-dd`, both included). */
export function overviewWindow(today: string): { from: string; to: string } {
  return { from: shiftDate(today, -OVERVIEW_DAYS_AROUND), to: shiftDate(today, OVERVIEW_DAYS_AROUND) }
}

const booked = (appointment: Pick<AppointmentListItemResponse, "status">) => appointment.status !== "Cancelled"

export interface DayCount {
  date: string
  /** Appointments that day in every status but cancelled. */
  count: number
  /** The dealership does not open on that weekday. */
  closed: boolean
  when: "past" | "today" | "future"
}

/** One entry per date of the window, in order. */
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
  /** Bookings in the fortnight before today, today, and the fortnight after. */
  past: number
  today: number
  ahead: number
  total: number
  /** The day with the most bookings (the earliest of equals); `null` when nothing is booked. */
  busiest: DayCount | null
  /** The most bookings on one day. */
  peak: number
}

export function bookingsSummary(days: readonly DayCount[]): BookingsSummary {
  const sum = (when: DayCount["when"]) => days.filter((day) => day.when === when).reduce((total, day) => total + day.count, 0)
  const busiest = days.reduce<DayCount | null>((best, day) => (day.count > (best?.count ?? 0) ? day : best), null)
  const [past, today, ahead] = [sum("past"), sum("today"), sum("future")]
  return { past, today, ahead, total: past + today + ahead, busiest, peak: busiest?.count ?? 0 }
}

/**
 * The runs of days the chart's line joins: consecutive days, broken at each closed day with nothing booked, so a closed
 * Sunday shows as a gap over the hatch rather than a drop to zero (a closed day is not a quiet one). Indices into `days`.
 */
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

/** "41 in the last 14 days, 6 today and 23 booked so far for the next 14. Busiest: Tuesday 13 October, with 6." */
export function chartSummary(summary: BookingsSummary): string {
  const sentence = `${summary.past} in the last ${OVERVIEW_DAYS_AROUND} days, ${summary.today} today and ${summary.ahead} booked so far for the next ${OVERVIEW_DAYS_AROUND}.`
  const busiest = summary.busiest && formatDay(summary.busiest.date, "long").replace(/ \d{4}$/, "")
  return summary.busiest ? `${sentence} Busiest: ${busiest}, with ${summary.busiest.count}.` : sentence
}

export interface ServiceShare {
  id: string
  name: string
  count: number
  /** Of every booking in the window, from 0 to 1. */
  share: number
}

export interface ServiceMix {
  /** At most `limit` services, the most booked first (then by name). */
  services: ServiceShare[]
  /** The rest, gathered into one row; `null` when every service has its own. */
  other: { count: number; services: number; share: number } | null
  total: number
}

/** Bookings by service over the window, cancelled ones left out. */
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
  // Six services fit as they are; a seventh would make a row of one, so "other" only gathers two or more.
  const shown = ranked.length > limit + 1 ? ranked.slice(0, limit) : ranked
  const rest = ranked.slice(shown.length)
  const otherCount = rest.reduce((sum, entry) => sum + entry.count, 0)
  return {
    services: shown,
    other: rest.length > 0 ? { count: otherCount, services: rest.length, share: total > 0 ? otherCount / total : 0 } : null,
    total,
  }
}

/** How many upcoming appointments the Overview lists. */
export const UPCOMING_LIMIT = 6

/**
 * The work still to do, soonest first: confirmed, checked-in and in-progress appointments that have not ended by `now`
 * (one under way stays at the top until it ends).
 */
export function upcomingAppointments(appointments: readonly AppointmentListItemResponse[], now: Date, limit = UPCOMING_LIMIT): AppointmentListItemResponse[] {
  const instant = now.getTime()
  return appointments
    .filter((appointment) => activeStatuses.includes(appointment.status) && Date.parse(appointment.endUtc) > instant)
    .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc) || a.id.localeCompare(b.id))
    .slice(0, limit)
}

export interface TodayByStatus {
  /** Today's appointments in every status but cancelled. */
  total: number
  counts: Map<AppointmentStatus, number>
  cancelled: number
}

/** Today's appointments on the dealership's calendar, by status. */
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

/**
 * Cancellations in the last seven days: the cancelled appointments due today or on the six days before, out of every
 * appointment due then. By the day the work was due, since the range read carries no cancellation time.
 */
export function cancellationsLastWeek(appointments: readonly AppointmentListItemResponse[], today: string) {
  const from = shiftDate(today, -6)
  const due = appointments.filter((appointment) => {
    const date = localDateOf(appointment)
    return date >= from && date <= today
  })
  return { from, to: today, cancelled: due.filter((appointment) => !booked(appointment)).length, due: due.length }
}
