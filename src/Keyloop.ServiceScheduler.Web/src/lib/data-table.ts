// Adopted from shadcn-dashboard-landing-template (vite-version) `src/lib/data-table.ts`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import {
  type Column,
  type ReactTable,
  type RowData,
  columnFacetingFeature,
  columnFilteringFeature,
  columnVisibilityFeature,
  createFacetedRowModel,
  createFacetedUniqueValues,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_arrIncludesSome,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
} from "@tanstack/react-table"

/** What a column tells the shared toolbar and table about itself, beyond TanStack's own options. */
export interface DataTableColumnMeta {
  /** The column's name in words, for the View menu (a header can be a sort button, so it is not plain text). */
  label?: string
  /** Classes for the column's header and body cells: width, alignment. */
  className?: string
}

/**
 * The TanStack Table v9 features every data table in the app uses: filtering (per column and a search across columns),
 * faceted filters, sorting, pagination and column visibility. Shared so the toolbar, pagination and column-header helpers
 * type against one feature set. Adopted from the template's `lib/data-table.ts`, without row selection (no list here acts on
 * several rows at once).
 */
export const dataTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  columnFacetingFeature,
  rowSortingFeature,
  rowPaginationFeature,
  columnVisibilityFeature,
  filteredRowModel: createFilteredRowModel(),
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  filterFns: {
    includesString: filterFn_includesString,
    arrIncludesSome: filterFn_arrIncludesSome,
  },
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
  columnMeta: {} as DataTableColumnMeta,
})

export type DataTableFeatures = typeof dataTableFeatures

/** How a list names what it holds, for its counts: one appointment, two technicians. */
export interface Noun {
  one: string
  other: string
}

/** "1 technician", "6 technicians". */
export function countOf(count: number, noun: Noun): string {
  return `${count} ${count === 1 ? noun.one : noun.other}`
}

/** The page sizes a data table offers; a table with no more rows than the smallest needs no paging at all. */
export const PAGE_SIZES = [10, 20, 30, 50] as const

/** The values a column's faceted filter has chosen; empty when the filter is off. */
export function selectedValues<TData extends RowData>(column: Column<DataTableFeatures, TData, unknown> | undefined): string[] {
  const value = column?.getFilterValue()
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
}

/** Whether the search or any column filter is narrowing the table. */
export function isFiltered<TData extends RowData>(table: ReactTable<DataTableFeatures, TData>): boolean {
  return table.state.columnFilters.length > 0 || Boolean(table.state.globalFilter)
}

/** Clears the search and every column filter (the template's Reset, which also cleared its search column). */
export function resetFilters<TData extends RowData>(table: ReactTable<DataTableFeatures, TData>): void {
  table.resetColumnFilters(true)
  table.setGlobalFilter("")
}
