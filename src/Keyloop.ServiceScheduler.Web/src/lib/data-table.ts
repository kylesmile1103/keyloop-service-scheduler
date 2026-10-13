// Adopted from shadcn-dashboard-landing-template (vite-version) `src/lib/data-table.ts`,
// Copyright (c) 2025 ShadcnStore, MIT License.
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

export interface DataTableColumnMeta {
  /** Column label for the View menu when the header is not plain text. */
  label?: string
  /** Header and body cell classes (width, alignment). */
  className?: string
}

/** Shared TanStack Table v9 feature set for all data tables (filtering, faceting, sorting, pagination, visibility). */
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

export interface Noun {
  one: string
  other: string
}

export function countOf(count: number, noun: Noun): string {
  return `${count} ${count === 1 ? noun.one : noun.other}`
}

export const PAGE_SIZES = [10, 20, 30, 50] as const

export function selectedValues<TData extends RowData>(column: Column<DataTableFeatures, TData, unknown> | undefined): string[] {
  const value = column?.getFilterValue()
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
}

export function isFiltered<TData extends RowData>(table: ReactTable<DataTableFeatures, TData>): boolean {
  return table.state.columnFilters.length > 0 || Boolean(table.state.globalFilter)
}

export function resetFilters<TData extends RowData>(table: ReactTable<DataTableFeatures, TData>): void {
  table.resetColumnFilters(true)
  table.setGlobalFilter("")
}

/** Focuses the nearest search input before resetting filters so focus is preserved when the empty-state reset button unmounts. */
export function resetFiltersFrom<TData extends RowData>(table: ReactTable<DataTableFeatures, TData>, control: Element): void {
  for (let node = control.parentElement; node; node = node.parentElement) {
    const field = node.querySelector<HTMLInputElement>('input[type="search"]')
    if (field) {
      field.focus()
      break
    }
  }
  resetFilters(table)
}
