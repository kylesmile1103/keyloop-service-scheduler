import { useQuery } from "@tanstack/react-query"
import { type ColumnVisibilityState, functionalUpdate, useTable } from "@tanstack/react-table"
import { ChevronRight, RefreshCw, RotateCw } from "lucide-react"
import { type ReactNode, type Ref, useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { Link, useLocation } from "react-router-dom"

import { getDealershipsOptions, getServiceTypesOptions, getWorkshopScheduleOptions } from "@/api/@tanstack/react-query.gen"
import type { DealershipResponse, WorkshopScheduleResponse } from "@/api/types.gen"
import { AppointmentSheet } from "@/app/dispatch/components/appointment-sheet"
import { DateNavigator } from "@/app/dispatch/components/date-navigator"
import { useBoardParams } from "@/app/dispatch/hooks/use-board-params"
import { statusMeta } from "@/app/dispatch/lib/status"
import type { Facet, FilterChoice } from "@/components/data-table/data-table-faceted-filter"
import { DataTablePagination } from "@/components/data-table/data-table-pagination"
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar"
import { FiltersSheet, type SortChoice } from "@/components/data-table/filters-sheet"
import { NoMatch } from "@/components/data-table/no-match"
import { ResultCount } from "@/components/data-table/result-count"
import { SearchField } from "@/components/data-table/search-field"
import { type DealershipListStatus, DealershipSelect } from "@/components/dealership-select"
import { FailedState } from "@/components/failed-state"
import { IllustratedState } from "@/components/illustrated-state"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useIsMobile } from "@/hooks/use-mobile"
import { useNow } from "@/hooks/use-now"
import { useQueryFailure } from "@/hooks/use-query-failure"
import { useSelectedDealership } from "@/hooks/use-selected-dealership"
import { formatDay, todayIn } from "@/lib/calendar-date"
import { dataTableFeatures, PAGE_SIZES } from "@/lib/data-table"
import { formatLocalTime } from "@/lib/local-time"
import { daySentence, nextOpenDate } from "@/lib/opening-hours"
import { cn } from "@/lib/utils"
import { carrySearch, WORKSHOP_PARAMS } from "@/lib/workshop-params"

import { AppointmentCards } from "./components/appointment-cards"
import { AppointmentsTable } from "./components/appointments-table"
import { appointmentColumns, canSearchColumn, searchFilter } from "./components/columns"
import { StatCards } from "./components/stat-cards"
import {
  APPOINTMENT_SEARCH,
  APPOINTMENTS,
  type AppointmentRow,
  appointmentRows,
  FACETS,
  type FacetId,
  filterOptions,
} from "./lib/appointments"
import { type OpenAppointment, OpenAppointmentContext, type RowIntent } from "./lib/row-actions"

/** Stable empties: TanStack Table re-derives every row model when its `data` changes identity. */
const NO_ROWS: AppointmentRow[] = []
const NO_OPTIONS: Record<FacetId, FilterChoice[]> = { status: [], bay: [], technician: [], service: [] }

/** The phone's sort choices: the table's column headers, as one select. */
const SORTS: readonly SortChoice[] = [
  { value: "time", label: "Time, earliest first", sorting: [{ id: "time", desc: false }] },
  { value: "time-desc", label: "Time, latest first", sorting: [{ id: "time", desc: true }] },
  { value: "status", label: "Status", sorting: [{ id: "status", desc: false }] },
  { value: "customer", label: "Customer, A to Z", sorting: [{ id: "customer", desc: false }] },
  { value: "service", label: "Service, A to Z", sorting: [{ id: "service", desc: false }] },
  { value: "bay", label: "Bay", sorting: [{ id: "bay", desc: false }] },
  { value: "technician", label: "Technician, A to Z", sorting: [{ id: "technician", desc: false }] },
]

export default function AppointmentsPage() {
  const dealershipsOptions = getDealershipsOptions()
  const dealerships = useQuery(dealershipsOptions)
  // Kept while Try again reads the list again, so the failure and its focused button stay until the answer.
  const dealershipsFailure = useQueryFailure(dealerships, dealershipsOptions.queryKey)
  const { selected, select } = useSelectedDealership(dealerships.data)
  const phone = useIsMobile()

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
    <BaseLayout title="Appointments" description="Search and filter one workshop day's bookings, and act on any of them.">
      <div className="flex min-w-0 flex-col gap-4 px-4 md:gap-5 md:px-6 xl:px-8">
        {selected ? (
          // A new table per dealership: its bays, technicians and filters are its own.
          <DealershipAppointments key={selected.id} dealership={selected} dealershipSelect={dealershipSelect} phone={phone} />
        ) : (
          <>
            <PageToolbar phone={phone}>{dealershipSelect}</PageToolbar>
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
                  <p>There are no dealerships to list appointments for. Once one is set up, it appears here.</p>
                </IllustratedState>
              </Card>
            ) : !dealerships.data && dealershipsFailure !== null ? (
              <Card className="py-0">
                <FailedState title="Couldn’t load dealerships" error={dealershipsFailure} onRetry={retry} retrying={dealerships.isFetching} />
              </Card>
            ) : (
              <>
                <p role="status" className="sr-only">
                  {dealerships.data ? "Finding a dealership with work today…" : "Loading dealerships…"}
                </p>
                <ListSkeleton phone={phone} />
              </>
            )}
          </>
        )}
      </div>
    </BaseLayout>
  )
}

/** The page's controls: which dealership and which day (the same address state as the board's). */
function PageToolbar({ phone, children }: { phone: boolean; children: ReactNode }) {
  return <div className={cn("flex gap-2", phone ? "flex-col" : "flex-wrap items-center")}>{children}</div>
}

interface Selection {
  row: AppointmentRow
  intent: RowIntent
  open: boolean
}

interface DealershipAppointmentsProps {
  dealership: DealershipResponse
  dealershipSelect: ReactNode
  /** The phone presentation: job cards, a filter sheet and bottom sheets. */
  phone: boolean
}

/**
 * One dealership's day as a list: the board's schedule read (`GET /schedule`, shared with the board through its query key),
 * flattened into rows. The day lives in the address (`?date=`, absent for today) exactly as on the board; the table's
 * search, filters, sort and page are this page's own and stay while the day changes.
 */
function DealershipAppointments({ dealership, dealershipSelect, phone }: DealershipAppointmentsProps) {
  const now = useNow()
  const timeZone = dealership.timeZoneId
  const today = todayIn(timeZone, now)
  const { date, setDate } = useBoardParams(today)
  const headingId = useId()
  const list = useRef<HTMLElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)

  const scheduleOptions = getWorkshopScheduleOptions({ path: { dealershipId: dealership.id }, query: { date } })
  const schedule = useQuery({ ...scheduleOptions, refetchOnWindowFocus: true })
  // A day that never loaded stays failed while it is read again, so Try again keeps focus until the answer.
  const failure = useQueryFailure(schedule, scheduleOptions.queryKey)
  // The whole catalogue, so the service filter offers the same choices whatever the day holds (the board reads it too).
  const catalogue = useQuery(getServiceTypesOptions({ path: { dealershipId: dealership.id } }))

  const rows = useMemo(() => (schedule.data ? appointmentRows(schedule.data) : NO_ROWS), [schedule.data])
  const options = useMemo(() => (schedule.data ? withStatusMarks(filterOptions(schedule.data, catalogue.data)) : NO_OPTIONS), [schedule.data, catalogue.data])
  const facets = useMemo<Facet[]>(() => FACETS.map((facet) => ({ ...facet, options: options[facet.id] })), [options])

  const columnVisibility = useColumnVisibility()

  const table = useTable({
    features: dataTableFeatures,
    data: rows,
    columns: appointmentColumns,
    initialState: { sorting: [{ id: "time", desc: false }], pagination: { pageIndex: 0, pageSize: PAGE_SIZES[0] } },
    state: { columnVisibility: columnVisibility.state },
    onColumnVisibilityChange: columnVisibility.onChange,
    globalFilterFn: searchFilter,
    getColumnCanGlobalFilter: canSearchColumn,
  })

  const openAppointment = useCallback<OpenAppointment>((row, intent, trigger) => {
    opener.current = trigger
    setSelection({ row, intent, open: true })
  }, [])

  // A Try again that succeeds takes its own button away with the failure; focus then moves to the list (below).
  const retried = useRef(false)
  const retry = () => {
    retried.current = true
    void schedule.refetch()
  }
  useEffect(() => {
    if (!schedule.data || !retried.current) return
    retried.current = false
    if (document.activeElement === document.body) list.current?.focus()
  }, [schedule.data])

  const dayWords = date === today ? "Today" : formatDay(date, "long")
  const current = selection?.open ? selection.row.id : null

  return (
    <OpenAppointmentContext value={openAppointment}>
      <PageToolbar phone={phone}>
        {dealershipSelect}
        <DateNavigator dealership={dealership} date={date} today={today} onDateChange={setDate} />
      </PageToolbar>

      <StatCards rows={schedule.data ? rows : undefined} failed={!schedule.data && failure !== null} dayWords={dayWords} />

      <ListFrame ref={list} phone={phone} headingId={headingId}>
        <ListHeader
          headingId={headingId}
          dealership={dealership}
          date={date}
          today={today}
          schedule={schedule.data}
          updatedAt={schedule.dataUpdatedAt}
          fetching={schedule.isFetching}
          phone={phone}
        />
        {!schedule.data && failure !== null ? (
          <FailedState
            title="Couldn’t load the appointments"
            error={failure}
            onRetry={retry}
            retrying={schedule.isFetching}
            level={3}
          />
        ) : !schedule.data ? (
          <>
            <p role="status" className="sr-only">
              Loading appointments…
            </p>
            <ListSkeleton phone={phone} framed={false} />
          </>
        ) : schedule.data.operatingWindow === null ? (
          <ClosedDay dealership={dealership} date={date} today={today} onDateChange={setDate} />
        ) : rows.length === 0 ? (
          <EmptyDay date={date} today={today} />
        ) : phone ? (
          <div className="flex flex-col gap-3">
            <SearchField
              value={String(table.state.globalFilter ?? "")}
              onChange={(value) => table.setGlobalFilter(value)}
              {...APPOINTMENT_SEARCH}
            />
            <div className="flex items-center justify-between gap-3">
              <FiltersSheet table={table} facets={facets} sorts={SORTS} noun={APPOINTMENTS} title="Filter appointments" />
              <ResultCount table={table} noun={APPOINTMENTS} />
            </div>
            {table.getRowModel().rows.length > 0 ? (
              <AppointmentCards rows={table.getRowModel().rows.map((row) => row.original)} timeZone={timeZone} selectedId={current} />
            ) : (
              <NoMatch table={table} noun={APPOINTMENTS} />
            )}
            <DataTablePagination table={table} compact />
          </div>
        ) : (
          <>
            <div className="border-b px-4 py-3">
              <DataTableToolbar table={table} facets={facets} search={APPOINTMENT_SEARCH} noun={APPOINTMENTS} />
            </div>
            <AppointmentsTable table={table} selectedId={current} />
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t px-4 py-2.5">
              <ResultCount table={table} noun={APPOINTMENTS} />
              <DataTablePagination table={table} />
            </div>
          </>
        )}
      </ListFrame>

      <AppointmentSheet
        appointment={selection?.row ?? null}
        open={selection?.open ?? false}
        onOpenChange={(open) => setSelection((previous) => (previous ? { ...previous, open } : previous))}
        side={phone ? "bottom" : "right"}
        dealershipId={dealership.id}
        date={date}
        timeZone={timeZone}
        initialFocus={selection?.intent === "cancel" ? "reason" : "title"}
        returnFocus={() => (opener.current?.isConnected ? opener.current : list.current)}
        onCancelled={() => {
          // Its row is about to leave the list: focus goes to the list instead.
          opener.current = null
        }}
      />
    </OpenAppointmentContext>
  )
}

/**
 * Which columns show. All ten fit from 1536 px; below that Duration is left out (the time range already says how long),
 * and below 1440 px VIN too (the registration names the vehicle; the details sheet and the search still have the VIN; the
 * sidebar stays open from 1280 px, so 1280 leaves the table less room than 1024). So the table fits its card without
 * scrolling sideways from 1024 px up; on a tablet held upright it scrolls inside its card, never the page. The View menu
 * brings either column back, and once the user has chosen, their choice stands whatever the width.
 */
function useColumnVisibility() {
  const wide = useMediaQuery("(min-width: 1536px)")
  const roomy = useMediaQuery("(min-width: 1440px)")
  const [chosen, setChosen] = useState<ColumnVisibilityState | null>(null)
  const state = chosen ?? { duration: wide, vin: roomy }
  return {
    state,
    onChange: (updater: ColumnVisibilityState | ((previous: ColumnVisibilityState) => ColumnVisibilityState)) =>
      setChosen((previous) => functionalUpdate(updater, previous ?? state)),
  }
}

/** The status filter's choices carry the status marker the table's rows and badges use. */
function withStatusMarks(options: Record<FacetId, FilterChoice[]>): Record<FacetId, FilterChoice[]> {
  return {
    ...options,
    status: options.status.map((option) => {
      const meta = statusMeta[option.value as keyof typeof statusMeta]
      return { ...option, mark: <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", meta.classes.dot)} /> }
    }),
  }
}

interface ListFrameProps {
  ref: Ref<HTMLElement>
  phone: boolean
  headingId: string
  children: ReactNode
}

/** The list's region: a card on wide screens, the plain page on a phone (whose cards are the cards). */
function ListFrame({ ref, phone, headingId, children }: ListFrameProps) {
  if (phone) {
    return (
      <section ref={ref} tabIndex={-1} aria-labelledby={headingId} className="flex flex-col gap-3 outline-none">
        {children}
      </section>
    )
  }
  return (
    <Card ref={ref as Ref<HTMLDivElement>} tabIndex={-1} role="region" aria-labelledby={headingId} className="gap-0 py-0 outline-none">
      {children}
    </Card>
  )
}

interface ListHeaderProps {
  headingId: string
  dealership: DealershipResponse
  date: string
  today: string
  schedule: WorkshopScheduleResponse | undefined
  updatedAt: number
  fetching: boolean
  phone: boolean
}

/** The dealership, its hours that day in its own zone (which names the zone every time on the page is in), and freshness. */
function ListHeader({ headingId, dealership, date, today, schedule, updatedAt, fetching, phone }: ListHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-1", phone ? "px-1" : "border-b px-4 py-3")}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 id={headingId} className="truncate font-heading text-lg font-semibold">
          {dealership.name}
        </h2>
        <p className="text-sm text-muted-foreground tabular-nums">{daySentence(dealership, date, today, schedule)}</p>
      </div>
      {schedule && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
          <RefreshCw aria-hidden="true" className={cn("size-3", fetching && "animate-spin")} />
          {`Updated ${formatLocalTime(new Date(updatedAt).toISOString(), dealership.timeZoneId)}`}
        </p>
      )}
    </div>
  )
}

/** A day the dealership does not open (UI_DESIGN 12.1): no list, a way to the next open day. */
function ClosedDay({
  dealership,
  date,
  today,
  onDateChange,
}: {
  dealership: DealershipResponse
  date: string
  today: string
  onDateChange: (date: string | null) => void
}) {
  const next = nextOpenDate(dealership, date)
  const dayName = (day: string) => formatDay(day, "long").replace(/ \d{4}$/, "")
  return (
    <IllustratedState
      illustration="closed-day"
      title={date === today ? "Closed today" : `Closed on ${dayName(date)}`}
      action={
        next && (
          <Button type="button" variant="signal" className="cursor-pointer" onClick={() => onDateChange(next)}>
            {`Go to ${dayName(next)}`}
            <ChevronRight aria-hidden="true" className="transition-transform duration-150 group-hover/button:translate-x-0.5" />
          </Button>
        )
      }
    >
      <p>{next ? `The workshop opens again on ${dayName(next)}.` : "The workshop does not open that day, so nothing is booked."}</p>
    </IllustratedState>
  )
}

/** An open day with nothing booked (UI_DESIGN 12.1): booking lives on the board, so the action goes there, on this day. */
function EmptyDay({ date, today }: { date: string; today: string }) {
  const { search } = useLocation()
  const dayName = formatDay(date, "long").replace(/ \d{4}$/, "")
  const bookable = date >= today
  return (
    <IllustratedState
      illustration="empty-schedule"
      title={date === today ? "No appointments today" : `No appointments on ${dayName}`}
      action={
        bookable && (
          <Link to={{ pathname: "/dispatch", search: carrySearch(search, WORKSHOP_PARAMS) }} className={cn(buttonVariants(), "group/button")}>
            Book on the dispatch board
            <ChevronRight aria-hidden="true" className="transition-transform duration-150 group-hover/button:translate-x-0.5" />
          </Link>
        )
      }
    >
      <p>{bookable ? "Nothing is booked yet." : "Nothing was booked that day."}</p>
    </IllustratedState>
  )
}

/** The list's shape while it loads (UI_DESIGN 11.18): rows of the table, or job cards on a phone. */
function ListSkeleton({ phone, framed = true }: { phone: boolean; framed?: boolean }) {
  const body = phone ? (
    <div aria-hidden="true" className="flex flex-col gap-2">
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-32 w-full rounded-chip" />
      ))}
    </div>
  ) : (
    <div aria-hidden="true" className="flex flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 w-28" />
      </div>
      {[0, 1, 2, 3, 4].map((index) => (
        <div key={index} className="flex h-11 items-center gap-6 border-b px-4 last:border-b-0">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </div>
  )
  return framed && !phone ? <Card className="gap-0 py-0">{body}</Card> : body
}

