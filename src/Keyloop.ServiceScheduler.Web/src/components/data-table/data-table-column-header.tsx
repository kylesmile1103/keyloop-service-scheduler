// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/tasks/components/data-table-column-header.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import type { Column, RowData } from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { DataTableFeatures } from "@/lib/data-table"
import { cn } from "@/lib/utils"

interface DataTableColumnHeaderProps<TData extends RowData, TValue> {
  column: Column<DataTableFeatures, TData, TValue>
  title: string
  className?: string
}

/**
 * A column's header: its name, and for a sortable column a button that sorts by it (ascending first, then the other way).
 * Adopted from the template's tasks table; the header cell carries `aria-sort`, so the arrows are only the visual cue.
 */
export function DataTableColumnHeader<TData extends RowData, TValue>({ column, title, className }: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <div className={className}>{title}</div>
  }

  const sorted = column.getIsSorted()
  const Arrow = sorted === "desc" ? ArrowDown : sorted === "asc" ? ArrowUp : ChevronsUpDown

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => column.toggleSorting(sorted === "asc")}
      className={cn(
        "-ml-1.5 h-8 cursor-pointer gap-1 px-1.5 text-xs font-medium text-muted-foreground hover:text-foreground data-[sorted=true]:text-foreground",
        className
      )}
      data-sorted={Boolean(sorted)}
    >
      {title}
      <Arrow aria-hidden="true" className="size-3.5" />
    </Button>
  )
}
