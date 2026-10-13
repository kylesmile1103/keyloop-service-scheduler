// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/tasks/components/data-table.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import type { ReactTable } from "@tanstack/react-table"
import { use, type MouseEvent } from "react"

import type { AppointmentStatus } from "@/api/types.gen"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { type DataTableFeatures, resetFiltersFrom } from "@/lib/data-table"
import { cn } from "@/lib/utils"

import type { AppointmentRow } from "../lib/appointments"
import { OpenAppointmentContext } from "../lib/row-actions"

const ariaSort = { asc: "ascending", desc: "descending" } as const

/**
 * The time column stays in view while a narrow table scrolls sideways inside its card (a tablet held upright), as the
 * board's lane column does. A sticky cell needs an opaque fill, so it paints the row's translucent tints over the card:
 * the header's `muted/50`, a hovered or menu-open row's `muted/50`, a selected row's `muted`.
 */
const halfMuted = "bg-[color-mix(in_srgb,var(--muted)_50%,var(--card))]"
// Below 1024 px, where the table can scroll, a hairline on its right edge keeps passing cells apart from it.
const stickyEdge = "sticky left-0 z-10 max-lg:shadow-[inset_-1px_0_0_var(--border)]"
const stickyHead = cn(stickyEdge, halfMuted)
const stickyCell = cn(
  stickyEdge,
  "bg-card",
  "group-hover/row:bg-[color-mix(in_srgb,var(--muted)_50%,var(--card))] group-has-aria-expanded/row:bg-[color-mix(in_srgb,var(--muted)_50%,var(--card))]",
  "group-data-[state=selected]/row:bg-muted"
)

/**
 * Each row's status marker bar (UI_DESIGN 11.12's 3 px left bar), drawn inside the sticky first cell so it stays with
 * it (a collapsed table border would scroll away). Full class names, so Tailwind sees them.
 */
const statusBar: Record<AppointmentStatus, string> = {
  Confirmed: "before:bg-status-confirmed-border",
  CheckedIn: "before:bg-status-checked-in-border",
  InProgress: "before:bg-status-in-progress-border",
  Completed: "before:bg-status-completed-border",
  NoShow: "before:bg-status-no-show-border",
  Cancelled: "before:bg-status-cancelled-border",
}

interface AppointmentsTableProps {
  table: ReactTable<DataTableFeatures, AppointmentRow>
  /** The appointment whose details sheet is open, highlighted in its row. */
  selectedId: string | null
}

/**
 * The day's appointments as a table, adopted from the template's tasks `data-table.tsx`. Each row starts with its status's
 * marker bar, so the list reads as the board's status map. A click anywhere on a row opens its details, as a block does
 * on the board; keyboard users have the row's actions button, which is also where focus returns when the sheet closes.
 * Wider than its card on a narrow screen, it scrolls sideways inside the card, never the page.
 */
export function AppointmentsTable({ table, selectedId }: AppointmentsTableProps) {
  const open = use(OpenAppointmentContext)
  const rows = table.getRowModel().rows
  const columnCount = table.getVisibleLeafColumns().length

  const openFromRow = (row: AppointmentRow, event: MouseEvent<HTMLTableRowElement>) => {
    // The row's own controls (its actions menu) handle their clicks.
    if (event.target instanceof Element && event.target.closest("button, a, input, [role=menu], [role=menuitem]")) return
    const trigger = event.currentTarget.querySelector<HTMLElement>("[data-row-actions]")
    open(row, "details", trigger ?? event.currentTarget)
  }

  return (
    <Table aria-label="Appointments">
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
                  className={cn("px-1.5", index === 0 && cn("pl-4", stickyHead), header.column.columnDef.meta?.className)}
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              )
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {rows.length > 0 ? (
          rows.map((row) => (
            <TableRow
              key={row.id}
              data-appointment-id={row.original.id}
              data-state={row.original.id === selectedId ? "selected" : undefined}
              onClick={(event) => openFromRow(row.original, event)}
              className="group/row cursor-pointer"
            >
              {row.getVisibleCells().map((cell, index) => (
                <TableCell
                  key={cell.id}
                  className={cn(
                    "px-1.5",
                    // The status marker bar, and the first column's text in line with the card's 16 px edge.
                    index === 0 && cn("pl-4 before:absolute before:inset-y-0 before:left-0 before:w-0.75", statusBar[row.original.status], stickyCell),
                    cell.column.columnDef.meta?.className
                  )}
                >
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={columnCount} className="h-32 text-center whitespace-normal">
              <div className="flex flex-col items-center gap-2">
                <p className="text-sm text-muted-foreground">No appointments match the search and filters.</p>
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
