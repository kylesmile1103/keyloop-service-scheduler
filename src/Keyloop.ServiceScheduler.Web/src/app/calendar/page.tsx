// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/calendar/page.tsx` and
// `src/app/calendar/components/calendar.tsx`, Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the
// README's licence section).
import { useQuery } from "@tanstack/react-query"
import { Plus, RotateCw } from "lucide-react"
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react"

import { getDealershipsOptions } from "@/api/@tanstack/react-query.gen"
import type { AppointmentListItemResponse, DealershipResponse } from "@/api/types.gen"
import { AppointmentSheet } from "@/app/dispatch/components/appointment-sheet"
import { StatusLegend } from "@/app/dispatch/components/status-legend"
import { useBookAction } from "@/app/dispatch/hooks/use-book-action"
import { type DealershipListStatus, DealershipSelect } from "@/components/dealership-select"
import { FailedState } from "@/components/failed-state"
import { IllustratedState } from "@/components/illustrated-state"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { useCurrentUser } from "@/hooks/use-current-user"
import { useIsMobile } from "@/hooks/use-mobile"
import { useNow } from "@/hooks/use-now"
import { useQueryFailure } from "@/hooks/use-query-failure"
import { useSelectedDealership } from "@/hooks/use-selected-dealership"
import { byLocalDate, localDateOf, rangeReadOptions } from "@/lib/appointment-range"
import { todayIn } from "@/lib/calendar-date"
import { cn } from "@/lib/utils"

import { CalendarAgenda } from "./components/calendar-agenda"
import { CalendarToolbar } from "./components/calendar-toolbar"
import { MonthView } from "./components/month-view"
import { WeekView } from "./components/week-view"
import { useCalendarParams } from "./hooks/use-calendar-params"
import { bookableDay, calendarDays, calendarRange, type CalendarView, dayInWords, inMonth, onCalendar, rangeTitle, shiftAnchor } from "./lib/calendar"

/** Calendar page displaying a dealership's appointments by week or month. */
export default function CalendarPage() {
  const dealershipsOptions = getDealershipsOptions()
  const dealerships = useQuery(dealershipsOptions)
  const dealershipsFailure = useQueryFailure(dealerships, dealershipsOptions.queryKey)
  const { selected, select } = useSelectedDealership(dealerships.data)
  const phone = useIsMobile()
  const identityKnown = useCurrentUser().status !== "loading"

  const status: DealershipListStatus = dealerships.data
    ? dealerships.data.length > 0
      ? "ready"
      : "empty"
    : dealershipsFailure !== null
      ? "failed"
      : "loading"
  const retry = () => void dealerships.refetch()
  const dealershipSelect = (
    <DealershipSelect
      dealerships={dealerships.data}
      value={selected?.id}
      onValueChange={select}
      status={status}
      className={cn(phone && "w-full data-[size=default]:h-11")}
    />
  )

  return (
    <BaseLayout title="Calendar" description="One dealership's appointments by week or month.">
      <div className={cn("flex min-w-0 flex-col gap-4 px-4 md:gap-5 md:px-6 xl:px-8", phone && "pb-24")}>
        {selected && identityKnown ? (
          <DealershipCalendar key={selected.id} dealership={selected} dealershipSelect={dealershipSelect} phone={phone} />
        ) : (
          <>
            {dealershipSelect}
            {dealerships.data?.length === 0 ? (
              <Card className="py-0">
                <IllustratedState
                  illustration="empty-schedule"
                  level={2}
                  title="No dealerships yet"
                  action={
                    <Button type="button" onClick={retry} disabled={dealerships.isFetching} focusableWhenDisabled>
                      <RotateCw aria-hidden="true" className={cn(dealerships.isFetching && "animate-spin")} />
                      Check again
                    </Button>
                  }
                >
                  <p>There are no dealerships to show. Once one is set up, it appears here.</p>
                </IllustratedState>
              </Card>
            ) : !dealerships.data && dealershipsFailure !== null ? (
              <Card className="py-0">
                <FailedState title="Couldn’t load dealerships" error={dealershipsFailure} onRetry={retry} retrying={dealerships.isFetching} />
              </Card>
            ) : (
              <>
                <p role="status" className="sr-only">
                  {selected ? "Checking who is signed in…" : dealerships.data ? "Finding a dealership with work today…" : "Loading dealerships…"}
                </p>
                <CalendarSkeleton />
              </>
            )}
          </>
        )}
      </div>
    </BaseLayout>
  )
}

interface Selection {
  appointment: AppointmentListItemResponse
  open: boolean
  identity: string
}

interface DealershipCalendarProps {
  dealership: DealershipResponse
  dealershipSelect: ReactNode
  phone: boolean
}

function DealershipCalendar({ dealership, dealershipSelect, phone }: DealershipCalendarProps) {
  const now = useNow()
  const timeZone = dealership.timeZoneId
  const today = todayIn(timeZone, now)
  const { view, anchor, setAnchor, setView, show } = useCalendarParams(today)
  const titleId = useId()
  const opener = useRef<HTMLElement | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const { identity } = useCurrentUser()
  if (selection && selection.identity !== identity) setSelection(null)
  const selected = selection?.identity === identity ? selection : null
  const book = useBookAction({ dealership, today, fullScreen: phone })

  const range = calendarRange(view, anchor)
  const rangeOptions = rangeReadOptions(dealership.id, range.from, range.to)
  const read = useQuery({ ...rangeOptions, refetchOnWindowFocus: true })
  const failure = useQueryFailure(read, rangeOptions.queryKey)
  const byDay = useMemo(() => byLocalDate(read.data ? onCalendar(read.data) : []), [read.data])

  const focusOnWeek = useRef<string | null>(null)
  const section = useRef<HTMLElement>(null)
  const weekSettled = view === "week" && (read.data !== undefined || failure !== null)
  useEffect(() => {
    const day = focusOnWeek.current
    if (day === null || !weekSettled || anchor !== day) return
    focusOnWeek.current = null
    const heading = section.current?.querySelector<HTMLElement>(`[data-day-heading="${day}"]`)
    ;(heading ?? document.getElementById(titleId))?.focus()
  }, [weekSettled, anchor, titleId])
  const showWeekOf = (date: string) => {
    focusOnWeek.current = date
    show({ view: "week", anchor: date })
  }

  const days = calendarDays(range)
  const listed = phone && view === "month" ? days.filter((date) => inMonth(date, anchor)) : days
  const empty = read.data !== undefined && listed.every((date) => (byDay.get(date)?.length ?? 0) === 0)
  const firstBookable = listed.map((date) => bookableDay(dealership, date, today)).find((date) => date !== null) ?? null
  const showsToday = range.from <= today && today <= range.to && (view === "week" || inMonth(today, anchor))

  const daysProps = {
    days: listed,
    byDay,
    dealership,
    today,
    selectedId: selected?.open ? selected.appointment.id : null,
    onSelect: (appointment: AppointmentListItemResponse, element: HTMLElement) => {
      opener.current = element
      setSelection({ appointment, open: true, identity })
    },
    onNew: (date: string) => book.open(date),
    bookState: book.bookState,
  }

  return (
    <Tabs
      value={view}
      onValueChange={(next: CalendarView) => {
        focusOnWeek.current = null
        setView(next)
      }}
      className="gap-4 md:gap-5"
    >
      <CalendarToolbar
        dealershipSelect={dealershipSelect}
        view={view}
        title={rangeTitle(view, anchor)}
        titleId={titleId}
        showsToday={showsToday}
        onStep={(step) => {
          focusOnWeek.current = null
          setAnchor(shiftAnchor(view, anchor, step))
        }}
        onToday={() => {
          focusOnWeek.current = null
          setAnchor(null)
        }}
        onNew={phone ? undefined : () => book.open(anchor)}
        bookState={book.bookState}
        phone={phone}
      />
      {book.reason}

      {(["week", "month"] as const).map((panel) => (
        <TabsContent key={panel} value={panel} tabIndex={-1}>
          {view === panel && (
            <section ref={section} aria-labelledby={titleId} aria-busy={read.isPending || undefined} className={cn((!phone || !read.data || empty) && "overflow-hidden rounded-xl bg-card shadow-xs ring-1 ring-foreground/10")}>
              {!read.data && failure !== null ? (
                <FailedState title="Couldn’t load the appointments" error={failure} onRetry={() => void read.refetch()} retrying={read.isFetching} level={3} />
              ) : !read.data ? (
                <>
                  <p role="status" className="sr-only">
                    Loading appointments…
                  </p>
                  <CalendarSkeleton framed={false} />
                </>
              ) : empty ? (
                <EmptyRange view={view} anchor={anchor} today={today} range={range} firstBookable={firstBookable} onNew={book.open} bookState={book.bookState} />
              ) : phone ? (
                <CalendarAgenda {...daysProps} />
              ) : view === "week" ? (
                <WeekView {...daysProps} />
              ) : (
                <MonthView {...daysProps} anchor={anchor} onShowWeek={showWeekOf} />
              )}
            </section>
          )}
        </TabsContent>
      ))}

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <StatusLegend />
        <p className="text-xs text-muted-foreground">{`Times in ${timeZone}. Cancelled appointments are not shown.`}</p>
      </div>

      <AppointmentSheet
        appointment={selected?.appointment ?? null}
        open={selected?.open ?? false}
        onOpenChange={(open) => setSelection((previous) => (previous ? { ...previous, open } : previous))}
        side={phone ? "bottom" : "right"}
        dealershipId={dealership.id}
        date={selected ? localDateOf(selected.appointment) : today}
        timeZone={timeZone}
        returnFocus={() => (opener.current?.isConnected ? opener.current : null)}
        onCancelled={() => {
          opener.current = null
        }}
      />
      {book.dialogs}

      {phone && (
        <Button
          type="button"
          variant="accent"
          data-slot="new-fab"
          aria-label="New appointment"
          onClick={() => book.open(anchor)}
          {...book.bookState}
          className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 h-14 rounded-full px-5 text-base shadow-lg ring-6 ring-brand-accent/25 pointer-coarse:h-14"
        >
          <Plus aria-hidden="true" className="size-6" />
          New
        </Button>
      )}
    </Tabs>
  )
}

interface EmptyRangeProps {
  view: CalendarView
  anchor: string
  today: string
  range: { from: string; to: string }
  firstBookable: string | null
  onNew: (date: string) => void
  bookState: ReturnType<typeof useBookAction>["bookState"]
}

/** Empty state shown when a week or month has no appointments. */
function EmptyRange({ view, anchor, today, range, firstBookable, onNew, bookState }: EmptyRangeProps) {
  const current = range.from <= today && today <= range.to
  const title =
    view === "month"
      ? `Nothing booked in ${rangeTitle("month", anchor).replace(/ \d{4}$/, "")}`
      : current
        ? "Nothing booked this week"
        : `Nothing booked from ${dayInWords(range.from)} to ${dayInWords(range.to)}`
  return (
    <IllustratedState
      illustration="empty-calendar"
      described
      level={3}
      title={title}
      className="px-4"
      action={
        firstBookable && (
          <Button type="button" onClick={() => onNew(firstBookable)} className="cursor-pointer" {...bookState}>
            <Plus aria-hidden="true" />
            New appointment
          </Button>
        )
      }
    >
      <p>{firstBookable ? "Appointments booked for these days appear here." : range.to < today ? "Nothing was booked in those days." : "The workshop is closed on these days."}</p>
    </IllustratedState>
  )
}

/** Loading skeleton for the calendar page. */
function CalendarSkeleton({ framed = true }: { framed?: boolean }) {
  const body = (
    <div aria-hidden="true" className="grid grid-cols-7 gap-px bg-border max-md:grid-cols-1">
      {[0, 1, 2, 3, 4, 5, 6].map((index) => (
        <div key={index} className="flex flex-col gap-2 bg-card p-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ))}
    </div>
  )
  return framed ? <Card className="gap-0 overflow-hidden py-0">{body}</Card> : body
}
