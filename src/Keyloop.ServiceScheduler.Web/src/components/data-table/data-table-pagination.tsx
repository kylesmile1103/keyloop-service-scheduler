// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/tasks/components/data-table-pagination.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import type { ReactTable, RowData } from "@tanstack/react-table"
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"
import { useId } from "react"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { type DataTableFeatures, PAGE_SIZES } from "@/lib/data-table"
import { cn } from "@/lib/utils"

interface DataTablePaginationProps<TData extends RowData> {
  table: ReactTable<DataTableFeatures, TData>
  /** The phone layout: previous and next only, as full touch targets. */
  compact?: boolean
  className?: string
}

/**
 * Rows per page and the page controls, adopted from the template's tasks table. It shows only when the rows outnumber the
 * smallest page, so a short day is not framed by controls that cannot do anything. Each button can disable itself when
 * pressed (the last page), so each keeps keyboard focus when it does.
 */
export function DataTablePagination<TData extends RowData>({ table, compact = false, className }: DataTablePaginationProps<TData>) {
  const sizeId = useId()
  const rows = table.getFilteredRowModel().rows.length
  if (rows <= PAGE_SIZES[0]) return null

  const { pageIndex, pageSize } = table.state.pagination
  const pageCount = table.getPageCount()
  const pageButton = "cursor-pointer max-md:size-11"

  return (
    <nav aria-label="Pages" className={cn("flex flex-wrap items-center justify-end gap-x-6 gap-y-2", className)}>
      {!compact && (
        <div className="flex items-center gap-2">
          <span id={sizeId} className="text-sm font-medium">
            Rows per page
          </span>
          <Select
            items={PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
            value={String(pageSize)}
            onValueChange={(value) => value && table.setPageSize(Number(value))}
          >
            <SelectTrigger size="sm" aria-labelledby={sizeId} className="w-20 cursor-pointer tabular-nums">
              <SelectValue />
            </SelectTrigger>
            <SelectContent side="top">
              <SelectGroup>
                {PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)} className="tabular-nums">
                    {size}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      )}
      <div className={cn("flex items-center gap-2", compact && "w-full justify-between")}>
        {!compact && (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className={pageButton}
            aria-label="Go to first page"
            disabled={!table.getCanPreviousPage()}
            focusableWhenDisabled
            onClick={() => table.setPageIndex(0)}
          >
            <ChevronsLeft aria-hidden="true" />
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className={pageButton}
          aria-label="Go to previous page"
          disabled={!table.getCanPreviousPage()}
          focusableWhenDisabled
          onClick={() => table.previousPage()}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <span className="min-w-24 text-center text-sm font-medium tabular-nums">{`Page ${pageIndex + 1} of ${pageCount}`}</span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className={pageButton}
          aria-label="Go to next page"
          disabled={!table.getCanNextPage()}
          focusableWhenDisabled
          onClick={() => table.nextPage()}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
        {!compact && (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className={pageButton}
            aria-label="Go to last page"
            disabled={!table.getCanNextPage()}
            focusableWhenDisabled
            onClick={() => table.setPageIndex(pageCount - 1)}
          >
            <ChevronsRight aria-hidden="true" />
          </Button>
        )}
      </div>
    </nav>
  )
}
