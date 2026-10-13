// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/users/components/data-table.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import type { ReactTable } from "@tanstack/react-table"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { type DataTableFeatures, type Noun, resetFiltersFrom } from "@/lib/data-table"
import { cn } from "@/lib/utils"

const ariaSort = { asc: "ascending", desc: "descending" } as const

/**
 * The first column stays in view while a narrow table scrolls sideways inside its card (a tablet held upright), as the
 * appointments list's time column does: an opaque fill repeating the row's tint, and below 1024 px a hairline on its edge.
 */
const halfMuted = "bg-[color-mix(in_srgb,var(--muted)_50%,var(--card))]"
const stickyEdge = "sticky left-0 z-10 max-lg:shadow-[inset_-1px_0_0_var(--border)]"
const stickyHead = cn(stickyEdge, halfMuted)
const stickyCell = cn(stickyEdge, "bg-card group-hover/row:bg-[color-mix(in_srgb,var(--muted)_50%,var(--card))]")

interface ResourceTableProps<TRow extends { id: string }> {
  table: ReactTable<DataTableFeatures, TRow>
  /** The table's accessible name: "Technicians". */
  label: string
  noun: Noun
  /**
   * The row actions slot, left for the admin dashboard's editing (Task 30): a trailing cell per row with the row's menu.
   * The lists are read-only until then, so no page passes it and no actions column is drawn.
   */
  rowActions?: (row: TRow) => ReactNode
}

/**
 * A resource list as a table, adopted from the template's users data table with the appointments list's anatomy
 * (UI_DESIGN 11.17): compact sortable headers with `aria-sort`, 44 px rows, numbers right-aligned, the first column held
 * in place while the table scrolls inside its card, and a row saying so when the search and filters match nothing. The
 * template's row selection, avatars from image URLs and per-role colours are not kept.
 */
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
