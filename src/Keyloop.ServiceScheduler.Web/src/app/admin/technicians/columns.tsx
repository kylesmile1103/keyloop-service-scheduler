// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/users/components/data-table.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License.
import type { ColumnDef } from "@tanstack/react-table"

import { CapabilityBadges } from "@/components/capability-badges"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { InitialsAvatar } from "@/components/initials-avatar"
import type { DataTableFeatures } from "@/lib/data-table"

import { ActiveState, LoadCell } from "../components/resource-cells"
import { activeFirst, activeValue, byName, facetFilter, searchFilter, todayValue } from "../lib/columns"
import type { TechnicianRecord } from "../lib/resources"

type Features = DataTableFeatures

export const TECHNICIAN_WORDS = { active: "Active", inactive: "Inactive" }

/** Searches technicians by name or employee number. */
export const technicianSearch = searchFilter<TechnicianRecord>((row) => [row.name, row.employeeNumber])

/** Table columns for the technician roster. */
export const technicianColumns: ColumnDef<Features, TechnicianRecord>[] = [
  {
    id: "name",
    accessorFn: (row) => row.name,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Technician" />,
    cell: ({ row }) => (
      <span className="flex max-w-56 items-center gap-2.5" title={row.original.name}>
        <InitialsAvatar name={row.original.name} size="sm" />
        <span className="truncate font-medium">{row.original.name}</span>
      </span>
    ),
    sortFn: byName((row) => row.name),
    enableHiding: false,
    meta: { label: "Technician" },
  },
  {
    id: "employeeNumber",
    accessorFn: (row) => row.employeeNumber,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Employee no." />,
    cell: ({ row }) => <span className="font-mono text-xs tracking-wide">{row.original.employeeNumber}</span>,
    sortFn: "alphanumeric",
    meta: { label: "Employee no." },
  },
  {
    id: "certifications",
    accessorFn: (row) => row.certifications.join(" "),
    header: ({ column }) => <DataTableColumnHeader column={column} title="Certified for" />,
    cell: ({ row }) => <CapabilityBadges certifications={row.original.certifications} max={2} className="max-w-80" />,
    getUniqueValues: (row) => row.certifications,
    filterFn: facetFilter((row) => row.certifications),
    enableSorting: false,
    meta: { label: "Certified for" },
  },
  {
    id: "status",
    accessorFn: activeValue,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => <ActiveState active={row.original.isActive} words={TECHNICIAN_WORDS} />,
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
    id: "booked",
    accessorFn: (row) => row.today.bookedMinutes,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Booked today" className="-mr-1.5" />,
    cell: ({ row }) => <LoadCell load={row.original.today} show="time" />,
    sortFn: "basic",
    meta: { label: "Booked today", className: "pr-4 text-right" },
  },
]
