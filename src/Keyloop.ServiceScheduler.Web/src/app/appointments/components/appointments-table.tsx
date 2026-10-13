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

const halfMuted = "bg-[color-mix(in_srgb,var(--muted)_50%,var(--card))]"
const stickyEdge = "sticky left-0 z-10 max-lg:shadow-[inset_-1px_0_0_var(--border)]"
const stickyHead = cn(stickyEdge, halfMuted)
const stickyCell = cn(
  stickyEdge,
  "bg-card",
  "group-hover/row:bg-[color-mix(in_srgb,var(--muted)_50%,var(--card))] group-has-aria-expanded/row:bg-[color-mix(in_srgb,var(--muted)_50%,var(--card))]",
  "group-data-[state=selected]/row:bg-muted"
)

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
  selectedId: string | null
}

/** Data table rendering the day's appointments with sticky time column and status bars. */
export function AppointmentsTable({ table, selectedId }: AppointmentsTableProps) {
  const open = use(OpenAppointmentContext)
  const rows = table.getRowModel().rows
  const columnCount = table.getVisibleLeafColumns().length

  const openFromRow = (row: AppointmentRow, event: MouseEvent<HTMLTableRowElement>) => {
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
