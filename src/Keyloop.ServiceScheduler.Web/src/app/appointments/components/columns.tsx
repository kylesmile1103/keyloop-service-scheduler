// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/tasks/components/columns.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import type { ColumnDef, FilterFn, Row, SortFn } from "@tanstack/react-table"

import { PlateChip } from "@/app/dispatch/components/appointment-block"
import { StatusBadge } from "@/app/dispatch/components/status-badge"
import { localTime } from "@/app/dispatch/lib/appointment-text"
import { boardStatuses } from "@/app/dispatch/lib/status"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { InitialsAvatar } from "@/components/initials-avatar"
import type { DataTableFeatures } from "@/lib/data-table"

import { type AppointmentRow, durationMinutes, matchesFacet, matchesSearch } from "../lib/appointments"
import { DataTableRowActions } from "./data-table-row-actions"

type Features = DataTableFeatures

const facet: FilterFn<Features, AppointmentRow> = (row, columnId, selected: readonly string[] | undefined) =>
  matchesFacet(String(row.getValue(columnId)), selected)
facet.autoRemove = (value) => !Array.isArray(value) || value.length === 0

export const searchFilter: FilterFn<Features, AppointmentRow> = (row, _columnId, query: unknown) =>
  matchesSearch(row.original, typeof query === "string" ? query : "")

const searchable = new Set(["customer", "registration", "vin"])
export const canSearchColumn = (column: { id: string }) => searchable.has(column.id)

const byName =
  (name: (row: AppointmentRow) => string): SortFn<Features, AppointmentRow> =>
  (a: Row<Features, AppointmentRow>, b: Row<Features, AppointmentRow>) =>
    name(a.original).localeCompare(name(b.original), "en-GB", { numeric: true, sensitivity: "base" })

const byLifecycle: SortFn<Features, AppointmentRow> = (a, b) => boardStatuses.indexOf(a.original.status) - boardStatuses.indexOf(b.original.status)

/** Column definitions for the appointments data table. */
export const appointmentColumns: ColumnDef<Features, AppointmentRow>[] = [
  {
    id: "time",
    accessorFn: (row) => row.startUtc,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Time" />,
    cell: ({ row }) => (
      <span className="font-medium tabular-nums">{`${localTime(row.original.startLocal)}–${localTime(row.original.endLocal)}`}</span>
    ),
    sortFn: "basic",
    enableHiding: false,
    meta: { label: "Time" },
  },
  {
    id: "status",
    accessorFn: (row) => row.status,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
    sortFn: byLifecycle,
    filterFn: facet,
    meta: { label: "Status" },
  },
  {
    id: "service",
    accessorFn: (row) => row.serviceType.id,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Service" />,
    cell: ({ row }) => (
      <span className="block max-w-48 truncate font-medium" title={row.original.serviceType.name}>
        {row.original.serviceType.name}
      </span>
    ),
    sortFn: byName((row) => row.serviceType.name),
    filterFn: facet,
    meta: { label: "Service" },
  },
  {
    id: "bay",
    accessorFn: (row) => row.bay.id,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Bay" />,
    cell: ({ row }) => (
      <span className="block max-w-40 truncate" title={row.original.bay.name}>
        {row.original.bay.name}
      </span>
    ),
    sortFn: byName((row) => row.bay.name),
    filterFn: facet,
    meta: { label: "Bay" },
  },
  {
    id: "technician",
    accessorFn: (row) => row.technician.id,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Technician" />,
    cell: ({ row }) => (
      <span className="flex max-w-44 items-center gap-2" title={row.original.technician.name}>
        <InitialsAvatar name={row.original.technician.name} size="sm" />
        <span className="truncate">{row.original.technician.name}</span>
      </span>
    ),
    sortFn: byName((row) => row.technician.name),
    filterFn: facet,
    meta: { label: "Technician" },
  },
  {
    id: "customer",
    accessorFn: (row) => row.customerName,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
    cell: ({ row }) => (
      <span className="block max-w-40 truncate" title={row.original.customerName}>
        {row.original.customerName}
      </span>
    ),
    sortFn: "text",
    meta: { label: "Customer" },
  },
  {
    id: "registration",
    accessorFn: (row) => row.registration,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Registration" />,
    cell: ({ row }) => <PlateChip registration={row.original.registration} labelled={false} />,
    sortFn: "alphanumeric",
    meta: { label: "Registration" },
  },
  {
    id: "vin",
    accessorFn: (row) => row.vin,
    header: ({ column }) => <DataTableColumnHeader column={column} title="VIN" />,
    cell: ({ row }) => <span className="font-mono text-xs tracking-wide">{row.original.vin}</span>,
    sortFn: "alphanumeric",
    meta: { label: "VIN" },
  },
  {
    id: "duration",
    accessorFn: (row) => durationMinutes(row),
    header: ({ column }) => <DataTableColumnHeader column={column} title="Duration" className="-mr-1.5" />,
    cell: ({ row }) => <span className="tabular-nums">{`${durationMinutes(row.original)} min`}</span>,
    sortFn: "basic",
    meta: { label: "Duration", className: "text-right" },
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => <DataTableRowActions row={row.original} />,
    enableSorting: false,
    enableHiding: false,
    meta: { className: "w-px py-1 pr-4 pl-1.5 text-right pointer-coarse:py-0" },
  },
]
