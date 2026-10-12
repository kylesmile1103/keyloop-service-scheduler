// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/calendar/components/date-picker.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"
import { useState } from "react"
import { labelDayButton } from "react-day-picker"

import type { DealershipResponse } from "@/api/types.gen"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { formatDay, fromPickerDate, shiftDate, toPickerDate, weekdayOf } from "@/lib/calendar-date"
import { openingHoursOn } from "@/lib/opening-hours"
import { cn } from "@/lib/utils"

interface DateNavigatorProps {
  /** The board's date and today's, `yyyy-MM-dd` on the dealership's calendar. */
  date: string
  today: string
  /** A date to show, or `null` for today (the address leaves today out). */
  onDateChange: (date: string | null) => void
  /** Its weekly hours mark the days it is closed in the calendar. */
  dealership: DealershipResponse
  className?: string
}

/** Touch layouts get 44 px targets (task 16 mobile addendum). */
const touch = "max-md:h-11 pointer-coarse:h-11"
const touchIcon = "max-md:size-11 pointer-coarse:size-11"

/** The calendar's day names, with "closed" after a day the dealership does not open, which is otherwise only struck through. */
const dayLabels = {
  labelDayButton: (...args: Parameters<typeof labelDayButton>) => {
    const [, modifiers] = args
    return modifiers.closed ? `${labelDayButton(...args)}, closed` : labelDayButton(...args)
  },
}

/**
 * Which day the board shows: previous and next day, a calendar in a popover (adopted from the template calendar's
 * `date-picker`), and a way back to today. Days come from the dealership's calendar, never the browser's.
 */
export function DateNavigator({ date, today, onDateChange, dealership, className }: DateNavigatorProps) {
  const [open, setOpen] = useState(false)
  const go = (next: string) => onDateChange(next)
  const isClosed = (day: Date) => !openingHoursOn(dealership, weekdayOf(fromPickerDate(day)))

  return (
    <div role="group" aria-label="Day" className={cn("flex items-center gap-1", className)}>
      <Button type="button" variant="outline" size="icon" className={touchIcon} aria-label="Previous day" onClick={() => go(shiftDate(date, -1))}>
        <ChevronLeft aria-hidden="true" />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              aria-label={`Choose date, ${formatDay(date, "long")}`}
              className={cn("min-w-36 cursor-pointer justify-start tabular-nums max-md:flex-1", touch)}
            />
          }
        >
          <CalendarDays aria-hidden="true" className="text-muted-foreground" />
          {formatDay(date, "short")}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto max-w-[calc(100vw-1rem)] p-0">
          <PopoverTitle className="sr-only">Choose date</PopoverTitle>
          <Calendar
            mode="single"
            selected={toPickerDate(date)}
            defaultMonth={toPickerDate(date)}
            today={toPickerDate(today)}
            onSelect={(picked) => {
              if (!picked) return
              go(fromPickerDate(picked))
              setOpen(false)
            }}
            modifiers={{ closed: isClosed }}
            modifiersClassNames={{ closed: "text-muted-foreground [&_button]:font-normal [&_button]:line-through" }}
            labels={dayLabels}
            className="w-full [&_[role=gridcell]_button]:cursor-pointer [&_button]:cursor-pointer max-md:[--cell-size:--spacing(10)] pointer-coarse:[--cell-size:--spacing(11)]"
          />
          {/* w-0 min-w-full: the note wraps to the calendar's width instead of widening the popover past a phone screen. */}
          <p className="w-0 min-w-full border-t px-3 py-2 text-xs text-pretty text-muted-foreground">
            Struck-through days are closed. Dates follow {dealership.timeZoneId}.
          </p>
        </PopoverContent>
      </Popover>
      <Button type="button" variant="outline" size="icon" className={touchIcon} aria-label="Next day" onClick={() => go(shiftDate(date, 1))}>
        <ChevronRight aria-hidden="true" />
      </Button>
      {/* Focusable once it has done its job: pressed, it disables itself, which would drop keyboard focus. */}
      <Button
        type="button"
        variant="ghost"
        className={touch}
        disabled={date === today}
        focusableWhenDisabled
        onClick={() => onDateChange(null)}
      >
        Today
      </Button>
    </div>
  )
}
