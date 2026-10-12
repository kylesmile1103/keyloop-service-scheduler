import { functionalUpdate, type ColumnVisibilityState, useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import type { Facet } from "@/components/data-table/data-table-faceted-filter"
import type { SortChoice } from "@/components/data-table/filters-sheet"
import { useMediaQuery } from "@/hooks/use-media-query"
import { certifications } from "@/lib/features"
import { dataTableFeatures, PAGE_SIZES } from "@/lib/data-table"
import { useVehicleAware } from "@/lib/feature-switches"

import { ResourceList } from "../components/resource-list"
import { ResourcePage, type ResourceScope } from "../components/resource-page"
import { TODAY_CHOICES } from "../lib/columns"
import type { TechnicianRecord } from "../lib/resources"
import { useResourceList } from "../lib/use-resource-list"
import { technicianColumns, technicianSearch } from "./columns"
import { UnconfirmedLevelsNote } from "./competence"
import { COMPETENCE_CHOICES, competenceColumns, competenceOf } from "./competence-model"
import { TechnicianCards } from "./technician-cards"
import { TechnicianFigures } from "./technician-figures"

const TECHNICIANS = { one: "technician", other: "technicians" }
const SEARCH = { label: "Search technicians", placeholder: "Name or employee number" }

/** The phone's sort choices: the table's column headers, as one select. */
const SORTS: readonly SortChoice[] = [
  { value: "name", label: "Name, A to Z", sorting: [{ id: "name", desc: false }] },
  { value: "name-desc", label: "Name, Z to A", sorting: [{ id: "name", desc: true }] },
  { value: "employee", label: "Employee number", sorting: [{ id: "employeeNumber", desc: false }] },
  { value: "booked", label: "Most booked today", sorting: [{ id: "booked", desc: true }] },
  { value: "appointments", label: "Most appointments today", sorting: [{ id: "appointments", desc: true }] },
]

/** With vehicle-aware requirements on, the phone can sort by HV competence too. */
const COMPETENCE_SORT: SortChoice = { value: "hv", label: "Highest HV level", sorting: [{ id: "hv", desc: true }] }

/**
 * Which columns show. Without HV competence all six fit from 1024 px. With it (vehicle-aware requirements on) the brands
 * are left out below 1680 px, the employee number below 1536 px (the search still finds a technician by it) and today's
 * appointment count below 1440 px (the booked time stays, and the Today filter still counts), so the table fits its card
 * without scrolling sideways from 1024 px up. View brings them back, and once the user has chosen, the choice stands
 * whatever the width (the appointments list's rule, UI_DESIGN 11.17).
 */
function useColumnVisibility(withCompetence: boolean) {
  const widest = useMediaQuery("(min-width: 1680px)")
  const wide = useMediaQuery("(min-width: 1536px)")
  const desktop = useMediaQuery("(min-width: 1440px)")
  const [chosen, setChosen] = useState<ColumnVisibilityState | null>(null)
  const state = chosen ?? (withCompetence ? { brands: widest, employeeNumber: wide, appointments: desktop } : {})
  return {
    state,
    onChange: (updater: ColumnVisibilityState | ((previous: ColumnVisibilityState) => ColumnVisibilityState)) =>
      setChosen((previous) => functionalUpdate(updater, previous ?? state)),
  }
}

/** Stable empty rows: TanStack Table re-derives every row model when its `data` changes identity. */
const NO_ROWS: TechnicianRecord[] = []

/** The Technicians page (`/resources/technicians`): the dealership's roster, read-only until Task 30. */
export default function TechniciansPage() {
  return (
    <ResourcePage title="Technicians" description="Who works at the dealership, what they are certified for and how booked they are today.">
      {(scope) => <TechnicianList {...scope} />}
    </ResourcePage>
  )
}

function TechnicianList({ dealership, today, phone }: ResourceScope) {
  const read = useResourceList<TechnicianRecord>("technicians", { dealership, today })
  const rows = read.rows ?? NO_ROWS
  // HV competence (ADR-029): the schedule carries it to a role with vehicle-aware requirements on. Read-only until Task 30.
  const vehicleAware = useVehicleAware()
  const showCompetence = vehicleAware && rows.some((row) => competenceOf(row, today) !== null)
  const columnVisibility = useColumnVisibility(showCompetence)
  const columns = useMemo(() => {
    if (!showCompetence) return technicianColumns
    // After the certifications: what a technician may work on, then whether they take bookings and their day.
    const at = technicianColumns.findIndex((column) => column.id === "certifications") + 1
    return [...technicianColumns.slice(0, at), ...competenceColumns(today), ...technicianColumns.slice(at)]
  }, [showCompetence, today])
  const unconfirmed = showCompetence ? rows.filter((row) => competenceOf(row, today)?.confirmed === false).map((row) => row.name) : []

  const table = useTable({
    features: dataTableFeatures,
    data: rows,
    columns,
    initialState: { sorting: [{ id: "name", desc: false }], pagination: { pageIndex: 0, pageSize: PAGE_SIZES[0] } },
    state: { columnVisibility: columnVisibility.state },
    onColumnVisibilityChange: columnVisibility.onChange,
    globalFilterFn: technicianSearch,
    getColumnCanGlobalFilter: (column) => column.id === "name",
  })

  const facets = useMemo<Facet[]>(() => {
    const held = new Set(rows.flatMap((row) => row.certifications))
    return [
      {
        id: "status",
        title: "Status",
        options: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ],
      },
      {
        id: "certifications",
        title: "Certified for",
        options: [...held]
          .map((certification) => ({ value: certification, label: certifications[certification].label }))
          .sort((a, b) => a.label.localeCompare(b.label, "en-GB")),
      },
      ...(showCompetence ? [{ id: "hv", title: "HV competence", options: COMPETENCE_CHOICES }] : []),
      { id: "appointments", title: "Today", options: TODAY_CHOICES },
    ]
  }, [rows, showCompetence])

  return (
    <>
      <TechnicianFigures rows={read.rows} day={read.day} failed={read.failure !== null} />
      <UnconfirmedLevelsNote names={unconfirmed} />
      <ResourceList
        dealership={dealership}
        today={today}
        phone={phone}
        label="Technicians"
        noun={TECHNICIANS}
        search={SEARCH}
        facets={facets}
        sorts={showCompetence ? [...SORTS, COMPETENCE_SORT] : SORTS}
        table={table}
        read={read}
        cards={(page) => <TechnicianCards rows={page} today={showCompetence ? today : null} />}
        empty={{ title: "No technicians yet", text: "This dealership has no technicians on its roster.", illustration: "empty-technicians" }}
      />
    </>
  )
}
