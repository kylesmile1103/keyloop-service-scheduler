import type { ReactTable, RowData } from "@tanstack/react-table"

import { Button } from "@/components/ui/button"
import { type DataTableFeatures, type Noun, resetFilters } from "@/lib/data-table"

/** The phone's "nothing matches" under the search (a table says it in a row of its own). */
export function NoMatch<TData extends RowData>({ table, noun }: { table: ReactTable<DataTableFeatures, TData>; noun: Noun }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-chip border border-dashed border-border px-4 py-6 text-center">
      <p className="text-sm text-muted-foreground">{`No ${noun.other} match the search and filters.`}</p>
      <Button type="button" variant="outline" className="h-11 cursor-pointer" onClick={() => resetFilters(table)}>
        Reset filters
      </Button>
    </div>
  )
}
