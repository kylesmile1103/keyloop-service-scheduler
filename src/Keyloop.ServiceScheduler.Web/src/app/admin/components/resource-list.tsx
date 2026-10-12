import type { ReactTable } from "@tanstack/react-table"
import { RefreshCw, RotateCw } from "lucide-react"
import { type ReactNode, type Ref, useEffect, useId, useRef } from "react"

import type { DealershipResponse } from "@/api/types.gen"
import type { Facet } from "@/components/data-table/data-table-faceted-filter"
import { DataTablePagination } from "@/components/data-table/data-table-pagination"
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar"
import { FiltersSheet, type SortChoice } from "@/components/data-table/filters-sheet"
import { NoMatch } from "@/components/data-table/no-match"
import { ResultCount } from "@/components/data-table/result-count"
import { SearchField, type SearchCopy } from "@/components/data-table/search-field"
import { FailedState } from "@/components/failed-state"
import { IllustratedState } from "@/components/illustrated-state"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { DataTableFeatures, Noun } from "@/lib/data-table"
import type { Illustration } from "@/lib/illustrations"
import { formatLocalTime } from "@/lib/local-time"
import { daySentence } from "@/lib/opening-hours"
import { cn } from "@/lib/utils"

import type { ResourceRead } from "../lib/use-resource-list"
import { ResourceTable } from "./resource-table"

interface ResourceListProps<TRow extends { id: string }> {
  dealership: DealershipResponse
  today: string
  phone: boolean
  /** "Technicians": the table's and the cards' accessible name. */
  label: string
  noun: Noun
  search: SearchCopy
  facets: readonly Facet[]
  sorts: readonly SortChoice[]
  table: ReactTable<DataTableFeatures, TRow>
  read: ResourceRead<TRow>
  /** The phone presentation of the current page's rows, in the table's order. */
  cards: (rows: readonly TRow[]) => ReactNode
  /**
   * A dealership with none of these yet. Its picture is the empty schedule unless the list has its own (the empty locker
   * for the technicians and bays), which is then described: it shows what the headline does not say.
   */
  empty: { title: string; text: string; illustration?: Illustration }
  /** Each row's actions (an Admin's menu, Task 30b): a trailing cell in the table; the cards place their own. */
  rowActions?: (row: TRow) => ReactNode
  /** The list's own action in its header (Add technician, Add bay), at the right of the dealership's name. */
  action?: ReactNode
  /** A note under the header: why the action is unavailable to this role (`ReadOnlyNote`), or what just happened. */
  notice?: ReactNode
}

/**
 * One dealership's resource list, in the appointments list's frame (UI_DESIGN 11.17): a card headed by the dealership, its
 * hours today in its own zone (which names the zone of every figure) and when it was read; the toolbar (search, faceted
 * filters with counts, Reset, View); the table; the count and the pages. Below 768 px the rows become cards, the search
 * stays above them and sorting and filters move into a Filters sheet. Loading, failed and empty states are the app's own.
 */
export function ResourceList<TRow extends { id: string }>({
  dealership,
  today,
  phone,
  label,
  noun,
  search,
  facets,
  sorts,
  table,
  read,
  cards,
  empty,
  rowActions,
  action,
  notice,
}: ResourceListProps<TRow>) {
  const headingId = useId()
  const list = useRef<HTMLElement>(null)

  // A Try again that succeeds takes its own button away with the failure; focus then moves to the list.
  const retried = useRef(false)
  const retry = () => {
    retried.current = true
    read.retry()
  }
  useEffect(() => {
    if (!read.rows || !retried.current) return
    retried.current = false
    if (document.activeElement === document.body) list.current?.focus()
  }, [read.rows])

  const rows = table.getRowModel().rows.map((row) => row.original)

  return (
    <ListFrame ref={list} phone={phone} headingId={headingId}>
      <div className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-1", phone ? "px-1" : "border-b px-4 py-3")}>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={headingId} className="truncate font-heading text-lg font-semibold">
            {dealership.name}
          </h2>
          <p className="text-sm text-muted-foreground tabular-nums">{daySentence(dealership, today, today, read.day)}</p>
        </div>
        <div className={cn("flex items-center gap-3", phone && action && "w-full flex-col items-stretch")}>
          {read.rows && (
            <p className={cn("flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums", phone && action && "order-last")}>
              <RefreshCw aria-hidden="true" className={cn("size-3", read.fetching && "animate-spin")} />
              {`Updated ${formatLocalTime(new Date(read.updatedAt).toISOString(), dealership.timeZoneId)}`}
            </p>
          )}
          {action}
        </div>
      </div>
      {notice && <div className={cn(phone ? "px-1" : "border-b px-4 py-3")}>{notice}</div>}
      {!read.rows && read.failure !== null ? (
        <FailedState title={`Couldn’t load the ${noun.other}`} error={read.failure} onRetry={retry} retrying={read.fetching} level={3} />
      ) : !read.rows ? (
        <>
          <p role="status" className="sr-only">{`Loading ${noun.other}…`}</p>
          <ListBodySkeleton phone={phone} />
        </>
      ) : read.rows.length === 0 ? (
        <IllustratedState
          illustration={empty.illustration ?? "empty-schedule"}
          described={empty.illustration !== undefined}
          title={empty.title}
          action={
            <Button type="button" variant="outline" onClick={retry} disabled={read.fetching} focusableWhenDisabled className="cursor-pointer">
              <RotateCw aria-hidden="true" className={cn(read.fetching && "animate-spin")} />
              Check again
            </Button>
          }
        >
          <p>{empty.text}</p>
        </IllustratedState>
      ) : phone ? (
        <div className="flex flex-col gap-3">
          <SearchField value={String(table.state.globalFilter ?? "")} onChange={(value) => table.setGlobalFilter(value)} {...search} />
          <div className="flex items-center justify-between gap-3">
            <FiltersSheet table={table} facets={facets} sorts={sorts} noun={noun} title={`Filter ${noun.other}`} />
            <ResultCount table={table} noun={noun} />
          </div>
          {rows.length > 0 ? cards(rows) : <NoMatch table={table} noun={noun} />}
          <DataTablePagination table={table} compact />
        </div>
      ) : (
        <>
          <div className="border-b px-4 py-3">
            <DataTableToolbar table={table} facets={facets} search={search} noun={noun} />
          </div>
          <ResourceTable table={table} label={label} noun={noun} rowActions={rowActions} />
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t px-4 py-2.5">
            <ResultCount table={table} noun={noun} />
            <DataTablePagination table={table} />
          </div>
        </>
      )}
    </ListFrame>
  )
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

/** The list's rows while they load (UI_DESIGN 11.18): table rows, or cards on a phone. */
function ListBodySkeleton({ phone }: { phone: boolean }) {
  if (phone) {
    return (
      <div aria-hidden="true" className="flex flex-col gap-2">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-28 w-full rounded-chip" />
        ))}
      </div>
    )
  }
  return (
    <div aria-hidden="true" className="flex flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-28" />
      </div>
      {[0, 1, 2, 3, 4].map((index) => (
        <div key={index} className="flex h-11 items-center gap-6 border-b px-4 last:border-b-0">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-6 w-40 rounded-full" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </div>
  )
}

/** The whole list's shape before a dealership is chosen. */
export function ListSkeleton({ phone }: { phone: boolean }) {
  return phone ? (
    <ListBodySkeleton phone />
  ) : (
    <Card className="gap-0 py-0">
      <div aria-hidden="true" className="flex flex-col gap-1.5 border-b px-4 py-3">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      <ListBodySkeleton phone={false} />
    </Card>
  )
}

/** Four figure cards' shape before a dealership is chosen. */
export function FiguresSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} className="h-28 rounded-xl md:h-32" />
      ))}
    </div>
  )
}
