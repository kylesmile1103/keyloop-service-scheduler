// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/tasks/components/data-table-toolbar.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License.

import type { ReactTable, RowData } from "@tanstack/react-table"
import { RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { type DataTableFeatures, isFiltered, type Noun, resetFilters } from "@/lib/data-table"

import { DataTableFacetedFilter, type Facet } from "./data-table-faceted-filter"
import { DataTableViewOptions } from "./data-table-view-options"
import { SearchField, type SearchCopy } from "./search-field"

interface DataTableToolbarProps<TData extends RowData> {
  table: ReactTable<DataTableFeatures, TData>
  facets: readonly Facet[]
  search: SearchCopy
  noun: Noun
}

/** Table toolbar with global search, faceted column filters, filter reset, and column visibility menu. */
export function DataTableToolbar<TData extends RowData>({ table, facets, search, noun }: DataTableToolbarProps<TData>) {
  const filtered = isFiltered(table)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchField
        value={String(table.state.globalFilter ?? "")}
        onChange={(value) => table.setGlobalFilter(value)}
        {...search}
        className="w-full md:w-64 xl:w-72"
      />
      {facets.map((facet) => (
        <DataTableFacetedFilter key={facet.id} column={table.getColumn(facet.id)} title={facet.title} options={facet.options} noun={noun} />
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!filtered}
        focusableWhenDisabled
        onClick={() => resetFilters(table)}
        className="cursor-pointer"
      >
        <RotateCcw aria-hidden="true" />
        Reset filters
      </Button>
      <div className="ml-auto">
        <DataTableViewOptions table={table} />
      </div>
    </div>
  )
}
