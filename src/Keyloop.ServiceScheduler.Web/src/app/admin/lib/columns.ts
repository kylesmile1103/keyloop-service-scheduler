import type { FilterFn, RowData, SortFn } from "@tanstack/react-table"

import type { BayCapability, Certification } from "@/api/types.gen"
import type { DataTableFeatures } from "@/lib/data-table"
import { featureList } from "@/lib/features"

import { type DayLoad, matchesSearch } from "./resources"

/** Multi-select faceted filter matching rows that contain any selected value. */
export function facetFilter<TRow extends RowData>(valuesOf: (row: TRow) => readonly string[]): FilterFn<DataTableFeatures, TRow> {
  const filter: FilterFn<DataTableFeatures, TRow> = (row, _columnId, selected: readonly string[] | undefined) =>
    !selected || selected.length === 0 || valuesOf(row.original).some((value) => selected.includes(value))
  filter.autoRemove = (value) => !Array.isArray(value) || value.length === 0
  return filter
}

/** The list's search over the fields a row is known by (its name, an employee number or a code). */
export function searchFilter<TRow extends RowData>(fields: (row: TRow) => string[]): FilterFn<DataTableFeatures, TRow> {
  return (row, _columnId, query: unknown) => matchesSearch(fields(row.original), typeof query === "string" ? query : "")
}

/** Sorts by a name as people read it: "Bay 2" before "Bay 10". */
export function byName<TRow extends RowData>(name: (row: TRow) => string): SortFn<DataTableFeatures, TRow> {
  return (a, b) => name(a.original).localeCompare(name(b.original), "en-GB", { numeric: true, sensitivity: "base" })
}

/** Active (or in service) first. */
export function activeFirst<TRow extends RowData & { isActive: boolean }>(): SortFn<DataTableFeatures, TRow> {
  return (a, b) => Number(b.original.isActive) - Number(a.original.isActive)
}

/** The active-state facet's value for a row. */
export const activeValue = (row: { isActive: boolean }) => (row.isActive ? "active" : "inactive")

/** The "Today" facet's value for a row: some work today, or none. */
export const todayValue = (row: { today: DayLoad }) => (row.today.appointments > 0 ? "booked" : "free")

export const TODAY_CHOICES = [
  { value: "booked", label: "Has appointments" },
  { value: "free", label: "No appointments" },
]

/** The features (capabilities and certifications) a set of rows has between them, as facet choices, by name. */
export function featureChoices(
  rows: ReadonlyArray<{ capabilities?: readonly BayCapability[]; certifications?: readonly Certification[] }>
): Array<{ value: string; label: string }> {
  const labels = new Set<string>()
  for (const row of rows) for (const feature of featureList(row.capabilities ?? [], row.certifications ?? [])) labels.add(feature.label)
  return [...labels].sort((a, b) => a.localeCompare(b, "en-GB")).map((label) => ({ value: label, label }))
}

/** A row's features by name, for a feature facet (a capability and a certification of the same name are one need). */
export const featureLabels = (capabilities: readonly BayCapability[], certifications: readonly Certification[]) =>
  featureList(capabilities, certifications).map((feature) => feature.label)
