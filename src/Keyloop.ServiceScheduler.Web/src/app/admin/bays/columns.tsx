// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/users/components/data-table.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License.
import type { ColumnDef } from "@tanstack/react-table"

import { CapabilityBadges } from "@/components/capability-badges"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import type { DataTableFeatures } from "@/lib/data-table"

import { ActiveState, LoadCell } from "../components/resource-cells"
import { activeFirst, activeValue, byName, facetFilter, featureLabels, searchFilter, todayValue } from "../lib/columns"
import type { BayRecord } from "../lib/resources"

type Features = DataTableFeatures

export const BAY_WORDS = { active: "In service", inactive: "Out of service" }

/** The list's search: a bay's name. */
export const baySearch = searchFilter<BayRecord>((row) => [row.name])

/** A bay's load today: its booked share of the opening hours (0 on a closed day, which the cell says in words). */
const loadShare = (row: BayRecord) => (row.today.windowMinutes ? row.today.bookedMinutes / row.today.windowMinutes : 0)

/** Column definitions for the service bays table. */
export const bayColumns: ColumnDef<Features, BayRecord>[] = [
  {
    id: "name",
    accessorFn: (row) => row.name,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Bay" />,
    cell: ({ row }) => (
      <span className="block max-w-56 truncate font-medium" title={row.original.name}>
        {row.original.name}
      </span>
    ),
    sortFn: byName((row) => row.name),
    enableHiding: false,
    meta: { label: "Bay" },
  },
  {
    id: "equipment",
    accessorFn: (row) => row.capabilities.join(" "),
    header: ({ column }) => <DataTableColumnHeader column={column} title="Equipment" />,
    cell: ({ row }) => <CapabilityBadges capabilities={row.original.capabilities} max={3} className="max-w-96" />,
    getUniqueValues: (row) => featureLabels(row.capabilities, []),
    filterFn: facetFilter((row) => featureLabels(row.capabilities, [])),
    enableSorting: false,
    meta: { label: "Equipment" },
  },
  {
    id: "status",
    accessorFn: activeValue,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => <ActiveState active={row.original.isActive} words={BAY_WORDS} />,
    sortFn: activeFirst(),
    filterFn: facetFilter((row) => [activeValue(row)]),
    meta: { label: "Status" },
  },
  {
    id: "appointments",
    accessorFn: (row) => row.today.appointments,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Appointments today" className="-mr-1.5" />,
    cell: ({ row }) => <span className="tabular-nums">{row.original.today.appointments}</span>,
    getUniqueValues: (row) => [todayValue(row)],
    filterFn: facetFilter((row) => [todayValue(row)]),
    sortFn: "basic",
    meta: { label: "Appointments today", className: "text-right" },
  },
  {
    id: "load",
    accessorFn: loadShare,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Load today" className="-mr-1.5" />,
    cell: ({ row }) => <LoadCell load={row.original.today} show="share" />,
    sortFn: "basic",
    meta: { label: "Load today", className: "pr-4 text-right" },
  },
]
