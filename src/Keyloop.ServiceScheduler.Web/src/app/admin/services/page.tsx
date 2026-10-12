import { type ColumnVisibilityState, functionalUpdate, useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import type { Facet } from "@/components/data-table/data-table-faceted-filter"
import type { SortChoice } from "@/components/data-table/filters-sheet"
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
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({})

  const table = useTable({
    features: dataTableFeatures,
    data: rows,
    columns: serviceColumns,
    initialState: { sorting: [{ id: "name", desc: false }], pagination: { pageIndex: 0, pageSize: PAGE_SIZES[0] } },
    state: { columnVisibility },
    onColumnVisibilityChange: (updater) => setColumnVisibility((previous) => functionalUpdate(updater, previous)),
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
