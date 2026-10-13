import { type ColumnVisibilityState, functionalUpdate, useTable } from "@tanstack/react-table"
import { Plus } from "lucide-react"
import { useId, useMemo, useRef, useState } from "react"

import type { AdminBayResponse } from "@/api/types.gen"
import type { Facet } from "@/components/data-table/data-table-faceted-filter"
import type { SortChoice } from "@/components/data-table/filters-sheet"
import { toast } from "@/components/ui/toast"
import { useCurrentUser } from "@/hooks/use-current-user"
import { dataTableFeatures, PAGE_SIZES } from "@/lib/data-table"

import { ActivityDialog } from "../components/activity-dialog"
import { AdminButton, ReadOnlyNote } from "../components/admin-access"
import { DiscardedNote } from "../components/discarded-note"
import { ResourceList } from "../components/resource-list"
import { ResourcePage, type ResourceScope } from "../components/resource-page"
import { bayFields, bayWrite } from "../lib/changes"
import { featureChoices, TODAY_CHOICES } from "../lib/columns"
import { historyHref } from "../lib/history-link"
import { useRefreshAfterEdit } from "../lib/refresh"
import type { BayRecord } from "../lib/resources"
import { useAdminAccess } from "../lib/use-admin-access"
import { useOpenFor } from "../lib/use-open-for"
import { useResourceList } from "../lib/use-resource-list"
import { adminBayOf } from "./admin-record"
import { BayRowActions } from "./bay-actions"
import { BayCards } from "./bay-cards"
import { BayFigures } from "./bay-figures"
import { type BayEditing, BaySheet } from "./bay-form"
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

/**
 * The Bays page (`/resources/bays`): the dealership's service bays. An Admin adds and edits bays and takes them out of
 * service or back (Task 30b); a Service advisor or a Viewer sees the same list read-only.
 */
export default function BaysPage() {
  return (
    <ResourcePage title="Bays" description="The service bays, how they are equipped and how loaded they are today.">
      {(scope) => <BayList {...scope} />}
    </ResourcePage>
  )
}

function BayList({ dealership, today, phone }: ResourceScope) {
  const access = useAdminAccess("bays")
  const reasonId = useId()
  const read = useResourceList<BayRecord>("bays", { dealership, today, view: access.admin ? "admin" : "workshop" })
  const rows = read.rows ?? NO_ROWS
  const refresh = useRefreshAfterEdit()
  const { identity } = useCurrentUser()
  // Open for the identity it was opened for; closed without saving when who is signed in changes.
  const editor = useOpenFor<BayEditing>(identity)
  const activity = useOpenFor<BayRecord>(identity)
  const opener = useRef<HTMLElement | null>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const saved = (record: AdminBayResponse, title: string, description: string) => {
    toast.add({ type: "success", title, description })
    void refresh(dealership.id)
    return record
  }
  const rowActions = access.admin
    ? (row: BayRecord) => (
        <BayRowActions
          row={row}
          historyHref={historyHref(dealership.id, "bay", row.id)}
          onEdit={(target, trigger) => {
            opener.current = trigger
            editor.open({ mode: "edit", id: target.id, name: target.name })
          }}
          onActivity={(target, trigger) => {
            opener.current = trigger
            activity.open(target)
          }}
        />
      )
    : undefined
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
        cards={(page) => <BayCards rows={page} actions={rowActions} />}
        rowActions={rowActions}
        action={
          <AdminButton
            ref={addButton}
            admin={access.admin}
            reasonId={reasonId}
            onClick={() => {
              opener.current = addButton.current
              editor.open({ mode: "create" })
            }}
            className={phone ? "w-full" : undefined}
          >
            <Plus aria-hidden="true" />
            Add bay
          </AdminButton>
        }
        notice={
          access.admin ? (
            editor.discarded || activity.discarded ? (
              <DiscardedNote>The bay you were editing was closed without saving: who is signed in changed.</DiscardedNote>
            ) : null
          ) : (
            <ReadOnlyNote id={reasonId} reason={access.reason} />
          )
        }
        empty={{ title: "No bays yet", text: "This dealership has no service bays set up.", illustration: "empty-technicians" }}
      />
      {access.admin && (
        <>
          <BaySheet
            editing={editor.value}
            open={editor.isOpen}
            onOpenChange={(open) => !open && editor.close()}
            dealership={dealership}
            today={today}
            phone={phone}
            returnFocus={() => opener.current}
            onSaved={(record, editing) => {
              editor.close()
              saved(
                record,
                editing.mode === "edit" ? "Bay saved" : "Bay added",
                editing.mode === "edit" ? `${record.name}: changes apply to new bookings.` : `${record.name} is in service and takes bookings.`
              )
            }}
            onDiscarded={() => {
              editor.close()
              void refresh(dealership.id)
            }}
          />
          <ActivityDialog
            resource="bays"
            record={activity.value ? adminBayOf(activity.value) : null}
            fields={bayFields}
            writeOf={bayWrite}
            words={(record, off) =>
              off
                ? {
                    title: `Take ${record.name} out of service?`,
                    action: "Take out of service",
                    consequence: `${record.name} takes no new bookings. Appointments already booked keep ${record.name}, and the board flags them for review.`,
                  }
                : {
                    title: `Return ${record.name} to service?`,
                    action: "Return to service",
                    consequence: `${record.name} takes new bookings again. Appointments flagged because ${record.name} was out of service are no longer flagged for that.`,
                  }
            }
            open={activity.isOpen}
            onOpenChange={(open) => !open && activity.close()}
            dealership={dealership}
            today={today}
            returnFocus={() => opener.current}
            onDone={(record) => {
              activity.close()
              saved(
                record,
                record.isActive ? "Bay back in service" : "Bay taken out of service",
                record.isActive ? `${record.name} takes new bookings again.` : `${record.name} takes no new bookings. Its appointments stay, flagged for review.`
              )
            }}
          />
        </>
      )}
    </>
  )
}
