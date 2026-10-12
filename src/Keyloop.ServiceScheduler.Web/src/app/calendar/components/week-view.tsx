// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/calendar/components/calendar-main.tsx` (its
// calendar grid, laid out as one week), Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's
// licence section).
import type { AppointmentListItemResponse, DealershipResponse } from "@/api/types.gen"
import type { BookState } from "@/app/dispatch/hooks/use-book-action"
import { formatDay } from "@/lib/calendar-date"
import { cn } from "@/lib/utils"

import { bookableDay, isOpen } from "../lib/calendar"
import { AppointmentChip } from "./appointment-chip"
import { DayLink, DayNumber, NewOnDay } from "./day-parts"

export interface DaysProps {
  days: readonly string[]
  /** The appointments to draw, by local date, each day's in start order. */
  byDay: ReadonlyMap<string, readonly AppointmentListItemResponse[]>
  dealership: DealershipResponse
  today: string
  selectedId: string | null
  onSelect: (appointment: AppointmentListItemResponse, chip: HTMLElement) => void
  onNew: (date: string) => void
  bookState: BookState
}

const count = (items: readonly unknown[]) => `${items.length}`

/**
 * A week, Monday to Sunday, as seven columns of the day's appointments in start order (the template's calendar grid,
 * one row tall). Not an hour grid: up to six bays work at once, and seven narrow columns cannot hold six overlapping
 * lanes; the dispatch board, a day heading's link away, is the hour grid of one day. A closed day is hatched as the board
 * hatches closed time; today's date sits in the filled circle; today and later open days offer New appointment.
 */
export function WeekView({ days, byDay, dealership, today, selectedId, onSelect, onNew, bookState }: DaysProps) {
  const timeZone = dealership.timeZoneId
  return (
    <ol className="grid grid-cols-7 gap-px bg-border">
      {days.map((date) => {
        const items = byDay.get(date) ?? []
        const open = isOpen(dealership, date)
        return (
          // A container: a narrow column (a tablet's week) keeps its heading to the day and its chips to the start time.
          <li key={date} className="@container/day flex min-w-0 flex-col bg-card">
            <div className="flex min-h-11 items-center justify-between gap-1 border-b px-1.5 py-1.5 @[9rem]/day:px-2">
              {/* Focusable by script only: "+N more" in the month moves focus here once the week is on screen. */}
              <h3 data-day-heading={date} tabIndex={-1} className="min-w-0 rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <DayLink date={date} today={today} dealershipId={dealership.id}>
                  <span className={cn("text-muted-foreground", date === today && "font-semibold text-foreground")}>{formatDay(date, "short").slice(0, 3)}</span>
                  <DayNumber date={date} today={today} />
                </DayLink>
              </h3>
              <span className="flex items-center gap-0.5">
                {items.length > 0 && (
                  <span className="sr-only text-xs text-muted-foreground tabular-nums @[9rem]/day:not-sr-only">
                    {count(items)}
                    <span className="sr-only">{items.length === 1 ? " appointment" : " appointments"}</span>
                  </span>
                )}
                {bookableDay(dealership, date, today) && <NewOnDay date={date} onNew={onNew} bookState={bookState} />}
              </span>
            </div>
            <div className={cn("flex min-h-72 flex-1 flex-col p-1.5", !open && "bg-hatch")}>
              {items.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {items.map((appointment) => (
                    <li key={appointment.id}>
                      <AppointmentChip appointment={appointment} timeZone={timeZone} density="week" selected={appointment.id === selectedId} onSelect={onSelect} />
                    </li>
                  ))}
                </ul>
              ) : !open ? (
                <span className="m-auto rounded-full bg-card px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-border">Closed</span>
              ) : (
                <span className="px-1 py-2 text-xs text-muted-foreground">{date < today ? "Nothing was booked" : "Nothing booked"}</span>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
