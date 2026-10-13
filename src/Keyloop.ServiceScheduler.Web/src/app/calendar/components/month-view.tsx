// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/calendar/components/calendar-main.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { cn } from "@/lib/utils"

import { bookableDay, dayInWords, inMonth, isOpen } from "../lib/calendar"
import { AppointmentChip } from "./appointment-chip"
import { DayLink, DayNumber, NewOnDay } from "./day-parts"
import type { DaysProps } from "./week-view"

const SHOWN = 3

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

interface MonthViewProps extends DaysProps {
  anchor: string
  onShowWeek: (date: string) => void
}

/** Month calendar grid showing up to three appointments per day and an overflow link to the week view. */
export function MonthView({ days, byDay, dealership, today, anchor, selectedId, onSelect, onNew, onShowWeek, bookState }: MonthViewProps) {
  const timeZone = dealership.timeZoneId
  return (
    <div>
      <div aria-hidden="true" className="grid grid-cols-7 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
        {WEEKDAYS.map((day) => (
          <span key={day} className="px-2 py-2">
            {day}
          </span>
        ))}
      </div>
      <ol className="grid grid-cols-7 gap-px bg-border">
        {days.map((date) => {
          const items = byDay.get(date) ?? []
          const own = inMonth(date, anchor)
          const open = isOpen(dealership, date)
          const visible = items.length > SHOWN ? items.slice(0, SHOWN - 1) : items
          const hidden = items.length - visible.length
          return (
            <li key={date} className={cn("flex min-h-28 min-w-0 flex-col", own ? "bg-card" : "bg-muted")}>
              <div className={cn("flex flex-1 flex-col gap-1 p-1.5 pointer-coarse:p-1", !open && "bg-hatch")}>
                <div className="flex flex-wrap items-center justify-between gap-1 pointer-coarse:gap-0.5">
                  <h3 className="text-sm">
                    <DayLink date={date} today={today} dealershipId={dealership.id}>
                      <DayNumber date={date} today={today} muted={!own} />
                    </DayLink>
                  </h3>
                  {bookableDay(dealership, date, today) && (
                    <span className="ms-auto flex">
                      <NewOnDay date={date} onNew={onNew} bookState={bookState} />
                    </span>
                  )}
                </div>
                {items.length > 0 ? (
                  <ul className="flex min-w-0 flex-col gap-1">
                    {visible.map((appointment) => (
                      <li key={appointment.id}>
                        <AppointmentChip appointment={appointment} timeZone={timeZone} density="month" selected={appointment.id === selectedId} onSelect={onSelect} />
                      </li>
                    ))}
                    {hidden > 0 && (
                      <li>
                        <button
                          type="button"
                          onClick={() => onShowWeek(date)}
                          aria-label={`${hidden} more on ${dayInWords(date)}: show the week`}
                          className="w-full cursor-pointer rounded-md px-1.5 py-0.5 text-left text-xs font-semibold text-signal outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
                        >
                          {`+${hidden} more`}
                        </button>
                      </li>
                    )}
                  </ul>
                ) : (
                  !open && <span className="mx-auto mt-auto mb-1 rounded-full bg-card px-2 py-0.5 text-2xs text-muted-foreground ring-1 ring-border">Closed</span>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
