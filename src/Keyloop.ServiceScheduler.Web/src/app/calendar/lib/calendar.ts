import type { AppointmentListItemResponse, DealershipResponse } from "@/api/types.gen"
import { datesFrom } from "@/lib/appointment-range"
import { formatDay, shiftDate, weekdayOf } from "@/lib/calendar-date"
import { openingHoursOn } from "@/lib/opening-hours"

export type CalendarView = "week" | "month"

export const VIEW_PARAM = "view"

const MONDAY_FIRST = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const

/** Returns the Monday on or before `date`. */
export function weekStart(date: string): string {
  return shiftDate(date, -MONDAY_FIRST.indexOf(weekdayOf(date) as (typeof MONDAY_FIRST)[number]))
}

const firstOfMonth = (date: string) => `${date.slice(0, 8)}01`

function lastOfMonth(date: string): string {
  const [year, month] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

/** Inclusive date bounds (`yyyy-MM-dd`) for a week or month calendar view. */
export function calendarRange(view: CalendarView, anchor: string): { from: string; to: string } {
  if (view === "week") {
    const from = weekStart(anchor)
    return { from, to: shiftDate(from, 6) }
  }
  return { from: weekStart(firstOfMonth(anchor)), to: shiftDate(weekStart(lastOfMonth(anchor)), 6) }
}

export function calendarDays(range: { from: string; to: string }): string[] {
  return datesFrom(range.from, range.to)
}

export function inMonth(date: string, anchor: string): boolean {
  return date.slice(0, 7) === anchor.slice(0, 7)
}

/** Shifts `anchor` by one week or month in the given direction. */
export function shiftAnchor(view: CalendarView, anchor: string, step: -1 | 1): string {
  if (view === "week") return shiftDate(anchor, 7 * step)
  const [year, month] = anchor.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1 + step, 1)).toISOString().slice(0, 10)
}

const dayMonthYear = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" })
const monthYear = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" })
const at = (date: string) => new Date(`${date}T00:00:00Z`)

/** Formats the header title for the current week or month range. */
export function rangeTitle(view: CalendarView, anchor: string): string {
  if (view === "month") return monthYear.format(at(anchor))
  const { from, to } = calendarRange("week", anchor)
  const [start, end] = [dayMonthYear.format(at(from)), dayMonthYear.format(at(to))]
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8))}–${end}`
  if (from.slice(0, 4) === to.slice(0, 4)) return `${start.replace(/ \d{4}$/, "")} – ${end}`
  return `${start} – ${end}`
}

/** Excludes cancelled appointments from the calendar display. */
export function onCalendar(appointments: readonly AppointmentListItemResponse[]): AppointmentListItemResponse[] {
  return appointments.filter((appointment) => appointment.status !== "Cancelled")
}

/** Returns `date` if it is today or later and the dealership is open; otherwise `null`. */
export function bookableDay(dealership: DealershipResponse, date: string, today: string): string | null {
  return date >= today && openingHoursOn(dealership, weekdayOf(date)) !== null ? date : null
}

export function isOpen(dealership: DealershipResponse, date: string): boolean {
  return openingHoursOn(dealership, weekdayOf(date)) !== null
}

export function dayInWords(date: string): string {
  return formatDay(date, "long").replace(/ \d{4}$/, "")
}
