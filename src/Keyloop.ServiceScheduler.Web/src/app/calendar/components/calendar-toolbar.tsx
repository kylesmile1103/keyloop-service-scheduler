// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/calendar/components/calendar-main.tsx` (its
// header) and `src/app/calendar/components/calendar-sidebar.tsx` (its new-event action), Copyright (c) 2025 ShadcnStore,
// MIT License (the full notice is in the README's licence section).
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Plus } from "lucide-react"
import type { ReactNode } from "react"

import type { BookState } from "@/app/dispatch/hooks/use-book-action"
import { Button } from "@/components/ui/button"
import { TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

import type { CalendarView } from "../lib/calendar"

interface CalendarToolbarProps {
  dealershipSelect: ReactNode
  view: CalendarView
  /** The range's title ("12–18 October 2026"), the calendar's `h2`. */
  title: string
  titleId: string
  /** The range holds today, so Today has nothing to do. */
  showsToday: boolean
  onStep: (step: -1 | 1) => void
  onToday: () => void
  /** New appointment, on wide screens; a phone has the floating action instead. */
  onNew?: () => void
  bookState: BookState
  phone: boolean
}

/** Touch layouts get 44 px targets (UI_DESIGN 14). */
const touch = "max-md:h-11 pointer-coarse:h-11"
const touchIcon = "max-md:size-11 pointer-coarse:size-11"

/**
 * The Calendar's controls (the template calendar's header): the dealership, previous and next week or month with Today
 * between, the range as the calendar's heading, the Week / Month view (the page's `Tabs` list, 11.5) and New appointment,
 * the view's one primary action. Wide screens keep them on one or two rows; a phone stacks the select, the steps and the
 * view, then the title.
 */
export function CalendarToolbar({ dealershipSelect, view, title, titleId, showsToday, onStep, onToday, onNew, bookState, phone }: CalendarToolbarProps) {
  const unit = view === "week" ? "week" : "month"
  const steps = (
    <div role="group" aria-label={`Choose the ${unit}`} className="flex items-center gap-1">
      <Button type="button" variant="outline" size="icon" className={cn("cursor-pointer", touchIcon)} aria-label={`Previous ${unit}`} onClick={() => onStep(-1)}>
        <ChevronLeft aria-hidden="true" />
      </Button>
      {/* Focusable once it has done its job: pressed, it disables itself, which would drop keyboard focus. */}
      <Button type="button" variant="outline" className={cn("cursor-pointer", touch)} disabled={showsToday} focusableWhenDisabled onClick={onToday}>
        Today
      </Button>
      <Button type="button" variant="outline" size="icon" className={cn("cursor-pointer", touchIcon)} aria-label={`Next ${unit}`} onClick={() => onStep(1)}>
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  )
  const views = (
    <TabsList aria-label="View" className={cn("pointer-coarse:min-h-12.5", phone && "h-11 group-data-horizontal/tabs:h-11")}>
      <TabsTrigger value="week" className="cursor-pointer px-2.5 pointer-coarse:min-h-11">
        <CalendarRange aria-hidden="true" />
        Week
      </TabsTrigger>
      <TabsTrigger value="month" className="cursor-pointer px-2.5 pointer-coarse:min-h-11">
        <CalendarDays aria-hidden="true" />
        Month
      </TabsTrigger>
    </TabsList>
  )
  const heading = (
    <h2 id={titleId} tabIndex={-1} className="rounded-sm font-heading text-lg font-semibold tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-live="polite">
      {title}
    </h2>
  )

  if (phone) {
    return (
      <div className="flex flex-col gap-2">
        {dealershipSelect}
        <div className="flex items-center justify-between gap-2">
          {steps}
          {views}
        </div>
        {heading}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        {dealershipSelect}
        {steps}
        {heading}
      </div>
      <div className="flex items-center gap-3">
        {views}
        {onNew && (
          <Button type="button" onClick={onNew} className="cursor-pointer pointer-coarse:h-11" {...bookState}>
            <Plus aria-hidden="true" />
            New appointment
          </Button>
        )}
      </div>
    </div>
  )
}
