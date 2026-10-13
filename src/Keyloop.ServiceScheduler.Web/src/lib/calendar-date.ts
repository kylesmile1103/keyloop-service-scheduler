import type { DayOfWeek } from "@/api/types.gen"

/** Dealership-local calendar date utilities (`yyyy-MM-dd`), using UTC-midnight arithmetic to avoid DST shifts. */

const pattern = /^(\d{4})-(\d{2})-(\d{2})$/

function parts(date: string): [number, number, number] {
  const match = pattern.exec(date)
  if (!match) throw new RangeError(`Expected a date written yyyy-MM-dd, got "${date}".`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

const utcMidnight = (date: string) => {
  const [year, month, day] = parts(date)
  return new Date(Date.UTC(year, month - 1, day))
}

const iso = (instant: Date) => instant.toISOString().slice(0, 10)

/** Whether a string is a real date written exactly `yyyy-MM-dd` (the form the schedule endpoint accepts). */
export function isCalendarDate(value: string): boolean {
  if (!pattern.test(value)) return false
  return iso(utcMidnight(value)) === value
}

/** Today's date on the dealership's calendar. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  // en-CA writes dates as yyyy-MM-dd.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

/** The date a whole number of days before (negative) or after a date. */
export function shiftDate(date: string, days: number): string {
  const instant = utcMidnight(date)
  instant.setUTCDate(instant.getUTCDate() + days)
  return iso(instant)
}

const weekdays: readonly DayOfWeek[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

/** The weekday of a date, named as the API names days in opening hours. */
export function weekdayOf(date: string): DayOfWeek {
  return weekdays[utcMidnight(date).getUTCDay()]
}

const dayFormats = {
  short: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }),
  long: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }),
  /** A date that may be years away (a competence's expiry): no weekday, the year kept. */
  dated: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }),
}

/** A date for people: "Tue 13 Oct" (short), "Tuesday 13 October 2026" (long) or "31 Dec 2028" (dated). */
export function formatDay(date: string, style: keyof typeof dayFormats): string {
  return dayFormats[style].format(utcMidnight(date)).replace(",", "")
}

/** The date picker works with local-midnight `Date`s in the browser's zone; this is the one for a calendar date. */
export function toPickerDate(date: string): Date {
  const [year, month, day] = parts(date)
  return new Date(year, month - 1, day)
}

/** The calendar date a picker `Date` stands for (its browser-local year, month and day). */
export function fromPickerDate(picked: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${picked.getFullYear()}-${pad(picked.getMonth() + 1)}-${pad(picked.getDate())}`
}
