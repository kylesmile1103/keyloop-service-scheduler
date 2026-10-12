import type { ReactTable, RowData } from "@tanstack/react-table"

import { countOf, type DataTableFeatures, isFiltered, type Noun } from "@/lib/data-table"

/** "6 appointments", or "2 of 6 appointments" while the search or a filter narrows the list; announced as it changes. */
export function ResultCount<TData extends RowData>({ table, noun }: { table: ReactTable<DataTableFeatures, TData>; noun: Noun }) {
  const total = table.getCoreRowModel().rows.length
  const shown = table.getFilteredRowModel().rows.length
  return (
    <p role="status" className="text-sm text-muted-foreground tabular-nums">
      {isFiltered(table) ? `${shown} of ${countOf(total, noun)}` : countOf(total, noun)}
    </p>
  )
}
