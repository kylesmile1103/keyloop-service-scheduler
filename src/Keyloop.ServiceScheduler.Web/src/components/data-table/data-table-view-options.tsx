// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/tasks/components/data-table-view-options.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import type { ReactTable, RowData } from "@tanstack/react-table"
import { Settings2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { DataTableFeatures } from "@/lib/data-table"

/**
 * Which columns the table shows, adopted from the template's tasks table. Columns are named by their `meta.label` (the
 * template wrote the column id); the ones a row cannot do without (time, actions) cannot be hidden.
 */
export function DataTableViewOptions<TData extends RowData>({ table }: { table: ReactTable<DataTableFeatures, TData> }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="cursor-pointer" />}>
        <Settings2 aria-hidden="true" className="text-muted-foreground" />
        View
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Columns</DropdownMenuLabel>
          {table
            .getAllLeafColumns()
            .filter((column) => column.accessorFn !== undefined && column.getCanHide())
            .map((column) => (
              <DropdownMenuCheckboxItem
                key={column.id}
                className="cursor-pointer pointer-coarse:min-h-11"
                checked={column.getIsVisible()}
                onCheckedChange={(visible) => column.toggleVisibility(visible)}
              >
                {column.columnDef.meta?.label ?? column.id}
              </DropdownMenuCheckboxItem>
            ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
