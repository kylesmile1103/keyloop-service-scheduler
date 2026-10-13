import { type ColumnFiltersState, functionalUpdate, type Updater } from "@tanstack/react-table"
import { useLayoutEffect, useRef } from "react"
import { useSearchParams } from "react-router-dom"

import { FACETS } from "./appointments"

/** List filters share the address with dealership/date, so reload and shared links restore the same view. */
export function useListParams() {
  const [params, setParams] = useSearchParams()
  // React Router does not queue functional search-parameter writes. Reset calls both table handlers in one event.
  const latest = useRef(params)
  useLayoutEffect(() => { latest.current = params }, [params])
  const write = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(latest.current)
    change(next)
    latest.current = next
    setParams(next, { replace: true })
  }
  const globalFilter = params.get("q") ?? ""
  const columnFilters: ColumnFiltersState = FACETS.flatMap(({ id }) => {
    const values = params.getAll(id).filter(Boolean)
    return values.length ? [{ id, value: values }] : []
  })

  const onGlobalFilterChange = (update: Updater<unknown>) => {
    const next = String(functionalUpdate(update, globalFilter) ?? "")
    write((result) => {
      if (next) result.set("q", next)
      else result.delete("q")
    })
  }
  const onColumnFiltersChange = (update: Updater<ColumnFiltersState>) => {
    const next = functionalUpdate(update, columnFilters)
    write((result) => {
      for (const { id } of FACETS) {
        result.delete(id)
        const values: unknown = next.find((filter) => filter.id === id)?.value
        if (Array.isArray(values)) {
          for (const value of values) if (typeof value === "string" && value) result.append(id, value)
        }
      }
    })
  }
  return { globalFilter, columnFilters, onGlobalFilterChange, onColumnFiltersChange }
}
