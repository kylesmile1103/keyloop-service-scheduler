// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/dashboard-2/page.tsx` and
// `src/app/dashboard/page.tsx`, Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence
// section).
import { useQuery } from "@tanstack/react-query"
import { Plus, RotateCw } from "lucide-react"
import { type ReactNode, useMemo, useRef, useState } from "react"
import { useLocation } from "react-router-dom"

import { getDealershipsOptions, getWorkshopScheduleOptions } from "@/api/@tanstack/react-query.gen"
import type { AppointmentListItemResponse, DealershipResponse } from "@/api/types.gen"
import { AppointmentSheet } from "@/app/dispatch/components/appointment-sheet"
import { useBookAction } from "@/app/dispatch/hooks/use-book-action"
import { type DealershipListStatus, DealershipSelect } from "@/components/dealership-select"
import { FailedState } from "@/components/failed-state"
import { IllustratedState } from "@/components/illustrated-state"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useCurrentUser } from "@/hooks/use-current-user"
import { useIsMobile } from "@/hooks/use-mobile"
import { useNow } from "@/hooks/use-now"
import { useQueryFailure } from "@/hooks/use-query-failure"
import { useSelectedDealership } from "@/hooks/use-selected-dealership"
import { localDateOf, rangeReadOptions } from "@/lib/appointment-range"
import { todayIn } from "@/lib/calendar-date"
import { daySentence } from "@/lib/opening-hours"
import { cn } from "@/lib/utils"
import { carrySearch, DEALERSHIP_PARAM } from "@/lib/workshop-params"

import { BookingsChart } from "./components/bookings-chart"
import { OverviewCards } from "./components/overview-cards"
import { QuickActions } from "./components/quick-actions"
import { ServiceMix } from "./components/service-mix"
import { UpcomingAppointments } from "./components/upcoming-appointments"
import { bookingsPerDay, bookingsSummary, overviewWindow, upcomingAppointments } from "./lib/overview"

/**
 * The Overview (`/overview`, the app's landing page): one dealership today and the fortnight either side, adopted from the
 * template's two dashboards (section cards, the interactive area chart, the breakdown, the recent list and the quick
 * actions). The dealership lives in the address (`?dealership=`) as on every workshop page; the day is always today on the
 * dealership's own calendar.
 */
export default function OverviewPage() {
  const dealershipsOptions = getDealershipsOptions()
  const dealerships = useQuery(dealershipsOptions)
  // Kept while Try again reads the list again, so the failure and its focused button stay until the answer.
  const dealershipsFailure = useQueryFailure(dealerships, dealershipsOptions.queryKey)
  const { selected, select } = useSelectedDealership(dealerships.data)
  const phone = useIsMobile()
  // The page waits for `/me` as the board does, so Book appointment appears in its final state.
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
    <BaseLayout title="Overview" description="One dealership today, and the fortnight either side.">
      <div className="flex min-w-0 flex-col gap-4 px-4 md:gap-6 md:px-6 xl:px-8">
        {selected && identityKnown ? (
          // A new overview per dealership: its selection and its reads are its own.
          <DealershipOverview key={selected.id} dealership={selected} dealershipSelect={dealershipSelect} phone={phone} />
        ) : (
          <>
            <Toolbar phone={phone} start={dealershipSelect} />
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
                <OverviewSkeleton />
              </>
            )}
          </>
        )}
      </div>
    </BaseLayout>
  )
}

/** The page's controls: the dealership and its hours today on the left, the quick actions on the right (stacked on a phone). */
function Toolbar({ phone, start, end }: { phone: boolean; start: ReactNode; end?: ReactNode }) {
  return (
    <div className={cn("flex gap-3", phone ? "flex-col" : "flex-wrap items-center justify-between")}>
      <div className={cn("flex min-w-0 gap-x-3 gap-y-1", phone ? "flex-col" : "flex-wrap items-center")}>{start}</div>
      {end}
    </div>
  )
}

interface Selection {
  appointment: AppointmentListItemResponse
  open: boolean
}

interface DealershipOverviewProps {
  dealership: DealershipResponse
  dealershipSelect: ReactNode
  phone: boolean
}

/**
 * One dealership's Overview from three reads: the range read for the fortnight either side of today (the chart, the service
 * mix, the upcoming list and two of the figures), today's schedule (bay utilisation; the board's own read, so the two share
 * the cache) and the availability behind the next free start.
 */
function DealershipOverview({ dealership, dealershipSelect, phone }: DealershipOverviewProps) {
  const now = useNow()
  const timeZone = dealership.timeZoneId
  const today = todayIn(timeZone, now)
  const { from, to } = overviewWindow(today)
  const { search } = useLocation()
  const opener = useRef<HTMLElement | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const book = useBookAction({ dealership, today, fullScreen: phone })

  const rangeOptions = rangeReadOptions(dealership.id, from, to)
  const range = useQuery({ ...rangeOptions, refetchOnWindowFocus: true })
  // A range that never loaded stays failed while it is read again, so Try again keeps focus until the answer.
  const rangeFailure = useQueryFailure(range, rangeOptions.queryKey)
  const scheduleOptions = getWorkshopScheduleOptions({ path: { dealershipId: dealership.id }, query: { date: today } })
  const schedule = useQuery({ ...scheduleOptions, refetchOnWindowFocus: true })
  const scheduleFailure = useQueryFailure(schedule, scheduleOptions.queryKey)

  const days = useMemo(() => (range.data ? bookingsPerDay(range.data, dealership, today) : undefined), [range.data, dealership, today])
  const summary = useMemo(() => (days ? bookingsSummary(days) : undefined), [days])
  const upcoming = range.data ? upcomingAppointments(range.data, now) : undefined
  const rangeFailed = !range.data && rangeFailure !== null
  const onDealership = (pathname: string) => ({ pathname, search: carrySearch(search, [DEALERSHIP_PARAM]) })

  const bookButton = (
    <Button type="button" onClick={() => book.open()} className="cursor-pointer" {...book.bookState}>
      <Plus aria-hidden="true" />
      Book appointment
    </Button>
  )

  return (
    <>
      <Toolbar
        phone={phone}
        start={
          <>
            {dealershipSelect}
            <p className="text-sm text-muted-foreground tabular-nums">{daySentence(dealership, today, today, schedule.data)}</p>
          </>
        }
        end={<QuickActions board={onDealership("/dispatch")} onBook={() => book.open()} bookState={book.bookState} stacked={phone} />}
      />
      {book.reason}

      <OverviewCards
        dealership={dealership}
        today={today}
        now={now}
        appointments={range.data}
        rangeFailed={rangeFailed}
        schedule={schedule.data}
        scheduleFailed={!schedule.data && scheduleFailure !== null}
      />

      {rangeFailed ? (
        <Card className="py-0">
          <FailedState title="Couldn’t load the appointments" error={rangeFailure} onRetry={() => void range.refetch()} retrying={range.isFetching} />
        </Card>
      ) : range.data?.length === 0 ? (
        <Card className="py-0">
          <IllustratedState illustration="dashboard-insights" described level={2} title="Nothing booked around today" action={bookButton}>
            <p>{`${dealership.name} has no appointments in the 14 days before or after today. Once work is booked, this page charts it.`}</p>
          </IllustratedState>
        </Card>
      ) : (
        <>
          <div className="grid min-w-0 gap-4 md:gap-6 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2">
              <BookingsChart dealershipId={dealership.id} today={today} days={days} summary={summary} />
            </div>
            <ServiceMix appointments={range.data} />
          </div>
          <UpcomingAppointments
            appointments={upcoming}
            today={today}
            timeZone={timeZone}
            calendar={onDealership("/calendar")}
            selectedId={selection?.open ? selection.appointment.id : null}
            onSelect={(appointment, row) => {
              opener.current = row
              setSelection({ appointment, open: true })
            }}
          />
        </>
      )}

      <AppointmentSheet
        appointment={selection?.appointment ?? null}
        open={selection?.open ?? false}
        onOpenChange={(open) => setSelection((previous) => (previous ? { ...previous, open } : previous))}
        side={phone ? "bottom" : "right"}
        dealershipId={dealership.id}
        date={selection ? localDateOf(selection.appointment) : today}
        timeZone={timeZone}
        returnFocus={() => (opener.current?.isConnected ? opener.current : null)}
        onCancelled={() => {
          // Its row leaves the list on the refetch.
          opener.current = null
        }}
      />
      {book.dialogs}
    </>
  )
}

/** The page's shape while the dealership and the identity load (UI_DESIGN 11.18). */
function OverviewSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 md:gap-6">
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-32 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-xl lg:col-span-2" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  )
}
