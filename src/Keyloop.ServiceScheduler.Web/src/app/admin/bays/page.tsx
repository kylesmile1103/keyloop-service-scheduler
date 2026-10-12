import { type ColumnVisibilityState, functionalUpdate, useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import type { Facet } from "@/components/data-table/data-table-faceted-filter"
import type { SortChoice } from "@/components/data-table/filters-sheet"
import { dataTableFeatures, PAGE_SIZES } from "@/lib/data-table"

import { ResourceList } from "../components/resource-list"
import { ResourcePage, type ResourceScope } from "../components/resource-page"
import { featureChoices, TODAY_CHOICES } from "../lib/columns"
import type { BayRecord } from "../lib/resources"
import { useResourceList } from "../lib/use-resource-list"
import { BayCards } from "./bay-cards"
import { BayFigures } from "./bay-figures"
import { bayColumns, baySearch } from "./columns"

const BAYS = { one: "bay", other: "bays" }
const SEARCH = { label: "Search bays", placeholder: "Bay name" }

/** The phone's sort choices: the table's column headers, as one select. */
const SORTS: readonly SortChoice[] = [
  { value: "name", label: "Name", sorting: [{ id: "name", desc: false }] },
  { value: "load", label: "Most loaded today", sorting: [{ id: "load", desc: true }] },
  { value: "appointments", label: "Most appointments today", sorting: [{ id: "appointments", desc: true }] },
  { value: "status", label: "In service first", sorting: [{ id: "status", desc: false }] },
]

/** Stable empty rows: TanStack Table re-derives every row model when its `data` changes identity. */
const NO_ROWS: BayRecord[] = []

/** The Bays page (`/resources/bays`): the dealership's service bays, read-only until Task 30. */
export default function BaysPage() {
  return (
    <ResourcePage title="Bays" description="The service bays, how they are equipped and how loaded they are today.">
      {(scope) => <BayList {...scope} />}
    </ResourcePage>
  )
}

function BayList({ dealership, today, phone }: ResourceScope) {
  const read = useResourceList<BayRecord>("bays", { dealership, today })
  const rows = read.rows ?? NO_ROWS
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({})

  const table = useTable({
    features: dataTableFeatures,
    data: rows,
    columns: bayColumns,
    initialState: { sorting: [{ id: "name", desc: false }], pagination: { pageIndex: 0, pageSize: PAGE_SIZES[0] } },
    state: { columnVisibility },
    onColumnVisibilityChange: (updater) => setColumnVisibility((previous) => functionalUpdate(updater, previous)),
    globalFilterFn: baySearch,
    getColumnCanGlobalFilter: (column) => column.id === "name",
  })

  const facets = useMemo<Facet[]>(
    () => [
      {
        id: "status",
        title: "Status",
        options: [
          { value: "active", label: "In service" },
          { value: "inactive", label: "Out of service" },
        ],
      },
      { id: "equipment", title: "Equipment", options: featureChoices(rows) },
      { id: "appointments", title: "Today", options: TODAY_CHOICES },
    ],
    [rows]
  )

  return (
    <>
      <BayFigures rows={read.rows} day={read.day} failed={read.failure !== null} />
      <ResourceList
        dealership={dealership}
        today={today}
        phone={phone}
        label="Bays"
        noun={BAYS}
        search={SEARCH}
        facets={facets}
        sorts={SORTS}
        table={table}
        read={read}
        cards={(page) => <BayCards rows={page} />}
        empty={{ title: "No bays yet", text: "This dealership has no service bays set up." }}
      />
    </>
  )
}
