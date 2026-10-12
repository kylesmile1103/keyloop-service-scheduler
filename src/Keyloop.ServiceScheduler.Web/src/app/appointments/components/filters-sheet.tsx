import type { ReactTable, SortingState } from "@tanstack/react-table"
import { SlidersHorizontal } from "lucide-react"
import { useId, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { type DataTableFeatures, isFiltered, resetFilters, selectedValues } from "@/lib/data-table"

import { type AppointmentRow, FACETS, type FacetId } from "../lib/appointments"
import { FacetChoices, type FilterChoice } from "./data-table-faceted-filter"

/** The phone's sort choices: the table's column headers, as one select. */
const SORTS: ReadonlyArray<{ value: string; label: string; sorting: SortingState }> = [
  { value: "time", label: "Time, earliest first", sorting: [{ id: "time", desc: false }] },
  { value: "time-desc", label: "Time, latest first", sorting: [{ id: "time", desc: true }] },
  { value: "status", label: "Status", sorting: [{ id: "status", desc: false }] },
  { value: "customer", label: "Customer, A to Z", sorting: [{ id: "customer", desc: false }] },
  { value: "service", label: "Service, A to Z", sorting: [{ id: "service", desc: false }] },
  { value: "bay", label: "Bay", sorting: [{ id: "bay", desc: false }] },
  { value: "technician", label: "Technician, A to Z", sorting: [{ id: "technician", desc: false }] },
]

interface FiltersSheetProps {
  table: ReactTable<DataTableFeatures, AppointmentRow>
  options: Record<FacetId, FilterChoice[]>
}

/**
 * On a phone the toolbar's filters live in a bottom sheet (as the board's do): the sort order, then the same faceted
 * filters as the table's popovers, each with its counts. The sheet's footer says how many appointments the choices leave
 * and closes on them; Reset clears the search and every filter.
 */
export function FiltersSheet({ table, options }: FiltersSheetProps) {
  const [open, setOpen] = useState(false)
  const sortId = useId()
  const active = FACETS.reduce((total, facet) => total + selectedValues(table.getColumn(facet.id)).length, 0)
  const shown = table.getFilteredRowModel().rows.length
  const [sorting] = table.state.sorting
  const sort = SORTS.find((candidate) => candidate.sorting[0].id === sorting?.id && candidate.sorting[0].desc === sorting.desc)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            type="button"
            variant="outline"
            aria-label={active > 0 ? `Filters, ${active} active` : "Filters"}
            className="h-11 shrink-0 cursor-pointer"
          />
        }
      >
        <SlidersHorizontal aria-hidden="true" className="text-muted-foreground" />
        Filters
        {active > 0 && (
          <Badge variant="secondary" className="tabular-nums">
            {active}
          </Badge>
        )}
      </SheetTrigger>
      <SheetContent side="bottom" className="gap-0 p-0 *:data-[slot=sheet-close]:size-11">
        <div aria-hidden="true" className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/40" />
        <SheetHeader className="pr-12">
          <SheetTitle>Filter appointments</SheetTitle>
          <SheetDescription>Sort the list and choose what it shows.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
          <div className="flex flex-col gap-1.5">
            <span id={sortId} className="text-sm font-medium">
              Sort by
            </span>
            <Select
              items={SORTS.map(({ value, label }) => ({ value, label }))}
              value={sort?.value ?? null}
              onValueChange={(value) => {
                const chosen = SORTS.find((candidate) => candidate.value === value)
                if (chosen) table.setSorting(chosen.sorting)
              }}
            >
              <SelectTrigger aria-labelledby={sortId} className="h-11 w-full cursor-pointer">
                <SelectValue placeholder="Column order" />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((candidate) => (
                  <SelectItem key={candidate.value} value={candidate.value} className="min-h-11">
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {FACETS.map((facet) => (
            // The rule sits on a wrapper: on the fieldset itself the legend would interrupt it.
            <div key={facet.id} className="border-t pt-3">
              <fieldset className="min-w-0">
                <legend className="mb-1 text-sm font-medium">{facet.title}</legend>
                <FacetChoices column={table.getColumn(facet.id)} options={options[facet.id]} />
              </fieldset>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t bg-popover px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button
            type="button"
            variant="ghost"
            className="h-11 cursor-pointer"
            disabled={!isFiltered(table)}
            focusableWhenDisabled
            onClick={() => resetFilters(table)}
          >
            Reset filters
          </Button>
          <Button type="button" className="h-11 flex-1 cursor-pointer" onClick={() => setOpen(false)}>
            {shown === 1 ? "Show 1 appointment" : `Show ${shown} appointments`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
