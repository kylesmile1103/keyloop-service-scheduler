import type { ReactTable, RowData, SortingState } from "@tanstack/react-table"
import { SlidersHorizontal } from "lucide-react"
import { useId, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { countOf, type DataTableFeatures, isFiltered, type Noun, resetFilters, selectedValues } from "@/lib/data-table"

import { FacetChoices, type Facet } from "./data-table-faceted-filter"

/** One of the phone's sort choices: a table column header as a sentence ("Customer, A to Z"). */
export interface SortChoice {
  value: string
  label: string
  sorting: SortingState
}

interface FiltersSheetProps<TData extends RowData> {
  table: ReactTable<DataTableFeatures, TData>
  facets: readonly Facet[]
  sorts: readonly SortChoice[]
  noun: Noun
  /** "Filter appointments". */
  title: string
}

/**
 * On a phone the toolbar's filters live in a bottom sheet (as the board's do): the sort order, then the same faceted
 * filters as the table's popovers, each with its counts. The sheet's footer says how many rows the choices leave and
 * closes on them; Reset clears the search and every filter.
 */
export function FiltersSheet<TData extends RowData>({ table, facets, sorts, noun, title }: FiltersSheetProps<TData>) {
  const [open, setOpen] = useState(false)
  const sortId = useId()
  const active = facets.reduce((total, facet) => total + selectedValues(table.getColumn(facet.id)).length, 0)
  const shown = table.getFilteredRowModel().rows.length
  const [sorting] = table.state.sorting
  const sort = sorts.find((candidate) => candidate.sorting[0]?.id === sorting?.id && candidate.sorting[0]?.desc === sorting.desc)

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
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>Sort the list and choose what it shows.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
          <div className="flex flex-col gap-1.5">
            <span id={sortId} className="text-sm font-medium">
              Sort by
            </span>
            <Select
              items={sorts.map(({ value, label }) => ({ value, label }))}
              value={sort?.value ?? null}
              onValueChange={(value) => {
                const chosen = sorts.find((candidate) => candidate.value === value)
                if (chosen) table.setSorting(chosen.sorting)
              }}
            >
              <SelectTrigger aria-labelledby={sortId} className="h-11 w-full cursor-pointer">
                <SelectValue placeholder="Column order" />
              </SelectTrigger>
              <SelectContent>
                {sorts.map((candidate) => (
                  <SelectItem key={candidate.value} value={candidate.value} className="min-h-11">
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {facets.map((facet) => (
            // The rule sits on a wrapper: on the fieldset itself the legend would interrupt it.
            <div key={facet.id} className="border-t pt-3">
              <fieldset className="min-w-0">
                <legend className="mb-1 text-sm font-medium">{facet.title}</legend>
                <FacetChoices column={table.getColumn(facet.id)} options={facet.options} noun={noun} />
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
            {`Show ${countOf(shown, noun)}`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
