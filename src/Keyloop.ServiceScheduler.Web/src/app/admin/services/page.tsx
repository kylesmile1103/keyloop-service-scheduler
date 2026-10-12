import { type ColumnVisibilityState, functionalUpdate, useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import type { Facet } from "@/components/data-table/data-table-faceted-filter"
import type { SortChoice } from "@/components/data-table/filters-sheet"
import { useMediaQuery } from "@/hooks/use-media-query"
import { dataTableFeatures, PAGE_SIZES } from "@/lib/data-table"

import { ResourceList } from "../components/resource-list"
import { ResourcePage, type ResourceScope } from "../components/resource-page"
import { featureChoices } from "../lib/columns"
import type { ServiceRecord } from "../lib/resources"
import { useResourceList } from "../lib/use-resource-list"
import { serviceColumns, serviceSearch } from "./columns"
import { ServiceCards } from "./service-cards"
import { ServiceFigures } from "./service-figures"

const SERVICES = { one: "service", other: "services" }
const SEARCH = { label: "Search services", placeholder: "Name or code" }

/** The phone's sort choices: the table's column headers, as one select. */
const SORTS: readonly SortChoice[] = [
  { value: "name", label: "Name, A to Z", sorting: [{ id: "name", desc: false }] },
  { value: "code", label: "Code", sorting: [{ id: "code", desc: false }] },
  { value: "shortest", label: "Shortest first", sorting: [{ id: "duration", desc: false }] },
  { value: "longest", label: "Longest first", sorting: [{ id: "duration", desc: true }] },
  { value: "bookable", label: "Bookable here first", sorting: [{ id: "bookable", desc: false }] },
  { value: "booked", label: "Most booked today", sorting: [{ id: "bookedToday", desc: true }] },
]

/**
 * Which columns show. All six fit from 1536 px; below that the code is left out (the search still finds a service by it),
 * so the table fits its card without scrolling sideways from 1024 px up. View brings it back, and once the user has chosen,
 * the choice stands whatever the width (the appointments list's rule, UI_DESIGN 11.17).
 */
function useColumnVisibility() {
  const wide = useMediaQuery("(min-width: 1536px)")
  const [chosen, setChosen] = useState<ColumnVisibilityState | null>(null)
  const state = chosen ?? { code: wide }
  return {
    state,
    onChange: (updater: ColumnVisibilityState | ((previous: ColumnVisibilityState) => ColumnVisibilityState)) =>
      setChosen((previous) => functionalUpdate(updater, previous ?? state)),
  }
}

/** Stable empty rows: TanStack Table re-derives every row model when its `data` changes identity. */
const NO_ROWS: ServiceRecord[] = []

/** The Services page (`/resources/services`): the service catalogue at the dealership, read-only until Task 30. */
export default function ServicesPage() {
  return (
    <ResourcePage title="Services" description="The service catalogue: how long each job takes, what it needs, and whether this dealership can book it.">
      {(scope) => <ServiceList {...scope} />}
    </ResourcePage>
  )
}

function ServiceList({ dealership, today, phone }: ResourceScope) {
  const read = useResourceList<ServiceRecord>("services", { dealership, today })
  const rows = read.rows ?? NO_ROWS
  const columnVisibility = useColumnVisibility()

  const table = useTable({
    features: dataTableFeatures,
    data: rows,
    columns: serviceColumns,
    initialState: { sorting: [{ id: "name", desc: false }], pagination: { pageIndex: 0, pageSize: PAGE_SIZES[0] } },
    state: { columnVisibility: columnVisibility.state },
    onColumnVisibilityChange: columnVisibility.onChange,
    globalFilterFn: serviceSearch,
    getColumnCanGlobalFilter: (column) => column.id === "name",
  })

  const facets = useMemo<Facet[]>(
    () => [
      {
        id: "bookable",
        title: "Bookable here",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
      },
      {
        id: "needs",
        title: "Needs",
        options: featureChoices(rows.map((row) => ({ capabilities: row.requiredBayCapabilities, certifications: row.requiredCertifications }))),
      },
    ],
    [rows]
  )

  return (
    <>
      <ServiceFigures rows={read.rows} failed={read.failure !== null} closed={read.day?.operatingWindow === null} />
      <ResourceList
        dealership={dealership}
        today={today}
        phone={phone}
        label="Services"
        noun={SERVICES}
        search={SEARCH}
        facets={facets}
        sorts={SORTS}
        table={table}
        read={read}
        cards={(page) => <ServiceCards rows={page} />}
        empty={{ title: "No services yet", text: "The service catalogue is empty." }}
      />
    </>
  )
}
