import type { DayOfWeek, DealershipResponse } from "@/api/types.gen"

export interface OpeningHours {
  /** Local wall-clock time, `HH:mm`. */
  opensAt: string
  closesAt: string
}

const weekdays: readonly DayOfWeek[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

/** The weekday at an instant in an IANA time zone, named as the API names days. */
export function weekdayIn(timeZone: string, instant: Date = new Date()): DayOfWeek {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(instant)
  const day = weekdays.find((weekday) => weekday === name)
  if (!day) throw new RangeError(`Unexpected weekday "${name}" for time zone ${timeZone}`)
  return day
}

/** The dealership's opening hours on a weekday, or `null` when it is closed that day. */
export function openingHoursOn(dealership: DealershipResponse, day: DayOfWeek): OpeningHours | null {
  const hours = dealership.operatingHours.find((entry) => entry.day === day)
  return hours?.opensAt && hours.closesAt ? { opensAt: hours.opensAt, closesAt: hours.closesAt } : null
}

function minutes(time: string): number {
  const [hours, mins] = time.split(":").map(Number)
  return hours * 60 + mins
}

const pad = (hour: number) => `${String(hour).padStart(2, "0")}:00`

/** The whole hours a timeline needs to cover the day: 07:30–18:30 is drawn from 07:00 to 19:00, marked 07:00 … 18:00. */
export function hourMarks({ opensAt, closesAt }: OpeningHours): string[] {
  const first = Math.floor(minutes(opensAt) / 60)
  const end = Math.ceil(minutes(closesAt) / 60)
  return Array.from({ length: Math.max(end - first, 0) }, (_, index) => pad(first + index))
}
