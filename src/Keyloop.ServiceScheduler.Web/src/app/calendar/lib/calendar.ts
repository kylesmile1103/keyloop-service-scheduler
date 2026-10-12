import type { AppointmentListItemResponse, DealershipResponse } from "@/api/types.gen"
import { datesFrom } from "@/lib/appointment-range"
import { formatDay, shiftDate, weekdayOf } from "@/lib/calendar-date"
import { openingHoursOn } from "@/lib/opening-hours"

/**
 * The Calendar's dates, all on the dealership's own calendar (`yyyy-MM-dd`, arithmetic on UTC midnights as in
 * lib/calendar-date, so a daylight-saving change never skips or repeats a day). Weeks start on Monday, as both seeded
 * dealerships (Reading, München) and ISO 8601 count them.
 */

export type CalendarView = "week" | "month"

/** The search parameter naming the view; without it the Calendar shows a week. */
export const VIEW_PARAM = "view"

const MONDAY_FIRST = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const

/** The Monday on or before a date. */
export function weekStart(date: string): string {
  return shiftDate(date, -MONDAY_FIRST.indexOf(weekdayOf(date) as (typeof MONDAY_FIRST)[number]))
}

const firstOfMonth = (date: string) => `${date.slice(0, 8)}01`

function lastOfMonth(date: string): string {
  const [year, month] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

/**
 * The dates a view reads and draws: a week from Monday to Sunday, or a month's whole weeks (from the Monday on or before
 * the 1st to the Sunday on or after its last day: 35 or 42 dates, inside the range read's 62).
 */
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

/** Whether a date is in the anchor's month (a month view's leading and trailing days are not). */
export function inMonth(date: string, anchor: string): boolean {
  return date.slice(0, 7) === anchor.slice(0, 7)
}

/** The anchor a step before (-1) or after (1): seven days for a week, the first of the month before or after for a month. */
export function shiftAnchor(view: CalendarView, anchor: string, step: -1 | 1): string {
  if (view === "week") return shiftDate(anchor, 7 * step)
  const [year, month] = anchor.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1 + step, 1)).toISOString().slice(0, 10)
}

const dayMonthYear = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" })
const monthYear = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" })
const at = (date: string) => new Date(`${date}T00:00:00Z`)

/** "12–18 October 2026", "28 September – 4 October 2026", "28 December 2026 – 3 January 2027", or "October 2026". */
export function rangeTitle(view: CalendarView, anchor: string): string {
  if (view === "month") return monthYear.format(at(anchor))
  const { from, to } = calendarRange("week", anchor)
  const [start, end] = [dayMonthYear.format(at(from)), dayMonthYear.format(at(to))]
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8))}–${end}`
  if (from.slice(0, 4) === to.slice(0, 4)) return `${start.replace(/ \d{4}$/, "")} – ${end}`
  return `${start} – ${end}`
}

/** What the Calendar draws: every status but cancelled, as the board and the Appointments list (cancelled work is not work). */
export function onCalendar(appointments: readonly AppointmentListItemResponse[]): AppointmentListItemResponse[] {
  return appointments.filter((appointment) => appointment.status !== "Cancelled")
}

/** The day itself when a New appointment may start on it (today or later, the dealership open); `null` otherwise. */
export function bookableDay(dealership: DealershipResponse, date: string, today: string): string | null {
  return date >= today && openingHoursOn(dealership, weekdayOf(date)) !== null ? date : null
}

/** Whether the dealership opens on a date. */
export function isOpen(dealership: DealershipResponse, date: string): boolean {
  return openingHoursOn(dealership, weekdayOf(date)) !== null
}

/** "Tuesday 13 October": a day in words, without the year the page's title already gives. */
export function dayInWords(date: string): string {
  return formatDay(date, "long").replace(/ \d{4}$/, "")
}
