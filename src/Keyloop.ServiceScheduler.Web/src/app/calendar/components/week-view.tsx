// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/calendar/components/calendar-main.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import type { AppointmentListItemResponse, DealershipResponse } from "@/api/types.gen"
import type { BookState } from "@/app/dispatch/hooks/use-book-action"
import { formatDay } from "@/lib/calendar-date"
import { cn } from "@/lib/utils"

import { bookableDay, isOpen } from "../lib/calendar"
import { AppointmentChip } from "./appointment-chip"
import { DayLink, DayNumber, NewOnDay } from "./day-parts"

export interface DaysProps {
  days: readonly string[]
  byDay: ReadonlyMap<string, readonly AppointmentListItemResponse[]>
  dealership: DealershipResponse
  today: string
  selectedId: string | null
  onSelect: (appointment: AppointmentListItemResponse, chip: HTMLElement) => void
  onNew: (date: string) => void
  bookState: BookState
}

const count = (items: readonly unknown[]) => `${items.length}`

/** Seven-column Monday-to-Sunday calendar grid of daily appointments. */
export function WeekView({ days, byDay, dealership, today, selectedId, onSelect, onNew, bookState }: DaysProps) {
  const timeZone = dealership.timeZoneId
  return (
    <ol className="grid grid-cols-7 gap-px bg-border">
      {days.map((date) => {
        const items = byDay.get(date) ?? []
        const open = isOpen(dealership, date)
        return (
          <li key={date} className="@container/day flex min-w-0 flex-col bg-card">
            <div className="flex min-h-11 flex-wrap items-center justify-between gap-1 border-b px-1.5 py-1.5 @[9rem]/day:px-2 @max-[8rem]/day:gap-0.5 @max-[8rem]/day:px-1 @max-[8rem]/day:py-1">
              <h3 data-day-heading={date} tabIndex={-1} className="min-w-0 rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                <DayLink date={date} today={today} dealershipId={dealership.id} className="@max-[8rem]/day:flex-col @max-[8rem]/day:justify-center @max-[8rem]/day:gap-0">
                  <span className={cn("text-muted-foreground @max-[8rem]/day:text-xs @max-[8rem]/day:leading-4", date === today && "font-semibold text-foreground")}>
                    {formatDay(date, "short").slice(0, 3)}
                  </span>
                  <DayNumber date={date} today={today} />
                </DayLink>
              </h3>
              <span className="ms-auto flex items-center gap-0.5">
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
