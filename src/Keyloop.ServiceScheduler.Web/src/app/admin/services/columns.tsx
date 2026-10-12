// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/users/components/data-table.tsx` (its column
// definitions), Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import type { ColumnDef } from "@tanstack/react-table"

import { CapabilityBadges } from "@/components/capability-badges"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import type { DataTableFeatures } from "@/lib/data-table"

import { byName, facetFilter, featureLabels, searchFilter } from "../lib/columns"
import type { ServiceRecord } from "../lib/resources"
import { BookableState } from "./bookable-cell"

type Features = DataTableFeatures

/** The list's search: a service's name or its catalogue code. */
export const serviceSearch = searchFilter<ServiceRecord>((row) => [row.name, row.code])

/** The "Bookable here" facet's value for a row. */
export const bookableValue = (row: ServiceRecord) => (row.bookable ? "yes" : "no")

const needs = (row: ServiceRecord) => featureLabels(row.requiredBayCapabilities, row.requiredCertifications)

/**
 * The catalogue's columns: the service, its stable code (monospace, an identifier), how long it holds a bay and a
 * technician, what it needs of both (the board's badges), whether this dealership can book it and today's bookings.
 */
export const serviceColumns: ColumnDef<Features, ServiceRecord>[] = [
  {
    id: "name",
    accessorFn: (row) => row.name,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Service" />,
    cell: ({ row }) => (
      <span className="block max-w-60 truncate font-medium" title={row.original.name}>
        {row.original.name}
      </span>
    ),
    sortFn: byName((row) => row.name),
    enableHiding: false,
    meta: { label: "Service" },
  },
  {
    id: "code",
    accessorFn: (row) => row.code,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />,
    cell: ({ row }) => <span className="font-mono text-xs tracking-wide">{row.original.code}</span>,
    sortFn: "alphanumeric",
    meta: { label: "Code" },
  },
  {
    id: "duration",
    accessorFn: (row) => row.durationMinutes,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Duration" className="-mr-1.5" />,
    cell: ({ row }) => <span className="tabular-nums">{`${row.original.durationMinutes} min`}</span>,
    sortFn: "basic",
    meta: { label: "Duration", className: "text-right" },
  },
  {
    id: "needs",
    accessorFn: (row) => needs(row).join(" "),
    header: ({ column }) => <DataTableColumnHeader column={column} title="Needs" />,
    cell: ({ row }) => (
      <CapabilityBadges
        capabilities={row.original.requiredBayCapabilities}
        certifications={row.original.requiredCertifications}
        label="Needs"
        max={2}
        className="max-w-80"
      />
    ),
    getUniqueValues: needs,
    filterFn: facetFilter(needs),
    enableSorting: false,
    meta: { label: "Needs" },
  },
  {
    id: "bookable",
    accessorFn: bookableValue,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Bookable here" />,
    cell: ({ row }) => <BookableState service={row.original} className="max-w-72" />,
    filterFn: facetFilter((row) => [bookableValue(row)]),
    sortFn: (a, b) => Number(b.original.bookable) - Number(a.original.bookable),
    meta: { label: "Bookable here" },
  },
  {
    id: "bookedToday",
    accessorFn: (row) => row.bookedToday,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Booked today" className="-mr-1.5" />,
    cell: ({ row }) => <span className="tabular-nums">{row.original.bookedToday}</span>,
    sortFn: "basic",
    meta: { label: "Booked today", className: "pr-4 text-right" },
  },
]
