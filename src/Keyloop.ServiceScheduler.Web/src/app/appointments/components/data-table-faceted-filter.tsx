import type { Column, RowData } from "@tanstack/react-table"
import { PlusCircle } from "lucide-react"
import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { type DataTableFeatures, selectedValues } from "@/lib/data-table"
import { cn } from "@/lib/utils"

import type { FacetOption } from "../lib/appointments"

/** A faceted filter's choice, with an optional mark drawn before its label (a status's swatch). */
export interface FilterChoice extends FacetOption {
  mark?: ReactNode
}

interface FacetChoicesProps<TData extends RowData> {
  column: Column<DataTableFeatures, TData, unknown> | undefined
  options: readonly FilterChoice[]
  className?: string
}

/**
 * A faceted filter's choices as checkboxes, each with how many appointments it holds given the other filters (a facet
 * leaves its own filter out, so the alternatives keep their counts). Shared by the toolbar's popovers and the phone's
 * filter sheet.
 */
export function FacetChoices<TData extends RowData>({ column, options, className }: FacetChoicesProps<TData>) {
  const counts = column?.getFacetedUniqueValues()
  const selected = selectedValues(column)

  const toggle = (value: string, checked: boolean) => {
    const next = checked ? [...selected, value] : selected.filter((entry) => entry !== value)
    column?.setFilterValue(next.length > 0 ? next : undefined)
  }

  return (
    <ul className={cn("flex flex-col", className)}>
      {options.map((option) => {
        const count = counts?.get(option.value) ?? 0
        return (
          <li key={option.value}>
            <Label className="flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 font-normal hover:bg-accent/50 max-md:min-h-11 pointer-coarse:min-h-11">
              <Checkbox checked={selected.includes(option.value)} onCheckedChange={(checked) => toggle(option.value, checked)} />
              {option.mark}
              {/* Read with the label: "Bay 1 - Standard (3 appointments)". */}
              <span className="min-w-0 flex-1 truncate">
                {option.label}
                <span className="sr-only">{` (${count} ${count === 1 ? "appointment" : "appointments"})`}</span>
              </span>
              <span aria-hidden="true" className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {count}
              </span>
            </Label>
          </li>
        )
      })}
    </ul>
  )
}

interface DataTableFacetedFilterProps<TData extends RowData> {
  column: Column<DataTableFeatures, TData, unknown> | undefined
  title: string
  options: readonly FilterChoice[]
}

/**
 * One column's faceted filter in the toolbar: a dashed button naming the column (and, once chosen, the choices), opening a
 * popover of checkboxes with counts. Adopted from the template's tasks table, with the command palette replaced by a plain
 * checkbox list: a dealership's day has a handful of statuses, bays, technicians and services, too few to need a search.
 */
export function DataTableFacetedFilter<TData extends RowData>({ column, title, options }: DataTableFacetedFilterProps<TData>) {
  const selected = selectedValues(column)
  const chosen = options.filter((option) => selected.includes(option.value))

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={selected.length > 0 ? `${title} filter, ${selected.length} selected` : `${title} filter`}
            className="cursor-pointer border-dashed"
          />
        }
      >
        <PlusCircle aria-hidden="true" className="text-muted-foreground" />
        {title}
        {selected.length > 0 && (
          <>
            <Separator orientation="vertical" className="mx-0.5 h-4 data-vertical:self-center" />
            <Badge variant="secondary" className="tabular-nums lg:hidden">
              {selected.length}
            </Badge>
            <span className="hidden gap-1 lg:flex">
              {selected.length > 2 ? (
                <Badge variant="secondary">{`${selected.length} selected`}</Badge>
              ) : (
                chosen.map((option) => (
                  <Badge key={option.value} variant="secondary" className="max-w-32">
                    <span className="truncate">{option.label}</span>
                  </Badge>
                ))
              )}
            </span>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-1.5 p-1.5">
        <PopoverHeader className="px-2 pt-1">
          <PopoverTitle className="text-sm">{title}</PopoverTitle>
        </PopoverHeader>
        <FacetChoices column={column} options={options} className="max-h-72 overflow-y-auto" />
        <Separator />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={selected.length === 0}
          // Pressed, it disables itself; focus stays on it, inside the popover.
          focusableWhenDisabled
          onClick={() => column?.setFilterValue(undefined)}
          className="cursor-pointer justify-center"
        >
          Clear filter
        </Button>
      </PopoverContent>
    </Popover>
  )
}
