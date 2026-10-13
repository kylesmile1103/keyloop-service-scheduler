// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/users/components/data-table.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License.
import type { ReactTable } from "@tanstack/react-table"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { type DataTableFeatures, type Noun, resetFiltersFrom } from "@/lib/data-table"
import { cn } from "@/lib/utils"

const ariaSort = { asc: "ascending", desc: "descending" } as const

/** Sticky styling for the first column on narrow viewports. */
const halfMuted = "bg-[color-mix(in_srgb,var(--muted)_50%,var(--card))]"
const stickyEdge = "sticky left-0 z-10 max-lg:shadow-[inset_-1px_0_0_var(--border)]"
const stickyHead = cn(stickyEdge, halfMuted)
const stickyCell = cn(stickyEdge, "bg-card group-hover/row:bg-[color-mix(in_srgb,var(--muted)_50%,var(--card))]")

interface ResourceTableProps<TRow extends { id: string }> {
  table: ReactTable<DataTableFeatures, TRow>
  /** The table's accessible name: "Technicians". */
  label: string
  noun: Noun
  /** Optional trailing actions cell per row. */
  rowActions?: (row: TRow) => ReactNode
}

/** Sortable resource data table with sticky first column and empty filter state. */
export function ResourceTable<TRow extends { id: string }>({ table, label, noun, rowActions }: ResourceTableProps<TRow>) {
  const rows = table.getRowModel().rows
  const columnCount = table.getVisibleLeafColumns().length + (rowActions ? 1 : 0)

  return (
    <Table aria-label={label}>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id} className="hover:bg-transparent">
            {headerGroup.headers.map((header, index) => {
              const sorted = header.column.getCanSort() ? header.column.getIsSorted() : false
              return (
                <TableHead
                  key={header.id}
                  colSpan={header.colSpan}
                  aria-sort={sorted ? ariaSort[sorted] : undefined}
                  className={cn("px-2", index === 0 && cn("pl-4", stickyHead), header.column.columnDef.meta?.className)}
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              )
            })}
            {rowActions && (
              <TableHead className="w-px pr-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            )}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {rows.length > 0 ? (
          rows.map((row) => (
            <TableRow key={row.id} className="group/row">
              {row.getVisibleCells().map((cell, index) => (
                <TableCell key={cell.id} className={cn("px-2", index === 0 && cn("pl-4", stickyCell), cell.column.columnDef.meta?.className)}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
              {rowActions && <TableCell className="w-px py-1 pr-4 pl-2 text-right">{rowActions(row.original)}</TableCell>}
            </TableRow>
          ))
        ) : (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={columnCount} className="h-32 text-center whitespace-normal">
              <div className="flex flex-col items-center gap-2">
                <p className="text-sm text-muted-foreground">{`No ${noun.other} match the search and filters.`}</p>
                <Button type="button" variant="outline" size="sm" className="cursor-pointer" onClick={(event) => resetFiltersFrom(table, event.currentTarget)}>
                  Reset filters
                </Button>
              </div>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
