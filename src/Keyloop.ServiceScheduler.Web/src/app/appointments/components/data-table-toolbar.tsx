import type { ReactTable } from "@tanstack/react-table"
import { RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { type DataTableFeatures, isFiltered, resetFilters } from "@/lib/data-table"

import { type AppointmentRow, FACETS, type FacetId } from "../lib/appointments"
import { DataTableFacetedFilter, type FilterChoice } from "./data-table-faceted-filter"
import { DataTableViewOptions } from "./data-table-view-options"
import { SearchField } from "./search-field"

interface DataTableToolbarProps {
  table: ReactTable<DataTableFeatures, AppointmentRow>
  options: Record<FacetId, FilterChoice[]>
}

/**
 * The table's controls, adopted from the template's tasks toolbar: the search, a faceted filter per status, bay, technician
 * and service, Reset, and the View menu on the right. Reset disables itself once pressed, so it keeps keyboard focus.
 */
export function DataTableToolbar({ table, options }: DataTableToolbarProps) {
  const filtered = isFiltered(table)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchField
        value={String(table.state.globalFilter ?? "")}
        onChange={(value) => table.setGlobalFilter(value)}
        className="w-full md:w-64 xl:w-72"
      />
      {FACETS.map((facet) => (
        <DataTableFacetedFilter key={facet.id} column={table.getColumn(facet.id)} title={facet.title} options={options[facet.id]} />
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
