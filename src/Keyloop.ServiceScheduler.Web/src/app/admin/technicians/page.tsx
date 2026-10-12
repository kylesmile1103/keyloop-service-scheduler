import { functionalUpdate, type ColumnVisibilityState, useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import type { Facet } from "@/components/data-table/data-table-faceted-filter"
import type { SortChoice } from "@/components/data-table/filters-sheet"
import { certifications } from "@/lib/features"
import { dataTableFeatures, PAGE_SIZES } from "@/lib/data-table"

import { ResourceList } from "../components/resource-list"
import { ResourcePage, type ResourceScope } from "../components/resource-page"
import { TODAY_CHOICES } from "../lib/columns"
import type { TechnicianRecord } from "../lib/resources"
import { useResourceList } from "../lib/use-resource-list"
import { technicianColumns, technicianSearch } from "./columns"
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
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({})

  const table = useTable({
    features: dataTableFeatures,
    data: rows,
    columns: technicianColumns,
    initialState: { sorting: [{ id: "name", desc: false }], pagination: { pageIndex: 0, pageSize: PAGE_SIZES[0] } },
    state: { columnVisibility },
    onColumnVisibilityChange: (updater) => setColumnVisibility((previous) => functionalUpdate(updater, previous)),
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
      { id: "appointments", title: "Today", options: TODAY_CHOICES },
    ]
  }, [rows])

  return (
    <>
      <TechnicianFigures rows={read.rows} day={read.day} failed={read.failure !== null} />
      <ResourceList
        dealership={dealership}
        today={today}
        phone={phone}
        label="Technicians"
        noun={TECHNICIANS}
        search={SEARCH}
        facets={facets}
        sorts={SORTS}
        table={table}
        read={read}
        cards={(page) => <TechnicianCards rows={page} />}
        empty={{ title: "No technicians yet", text: "This dealership has no technicians on its roster.", illustration: "empty-technicians" }}
      />
    </>
  )
}
