import { functionalUpdate, type ColumnVisibilityState, useTable } from "@tanstack/react-table"
import { Plus } from "lucide-react"
import { useId, useMemo, useRef, useState } from "react"

import type { AdminTechnicianResponse } from "@/api/types.gen"
import type { Facet } from "@/components/data-table/data-table-faceted-filter"
import type { SortChoice } from "@/components/data-table/filters-sheet"
import { toast } from "@/components/ui/toast"
import { useCurrentUser } from "@/hooks/use-current-user"
import { useMediaQuery } from "@/hooks/use-media-query"
import { certifications } from "@/lib/features"
import { dataTableFeatures, PAGE_SIZES } from "@/lib/data-table"
import { useVehicleAware } from "@/lib/feature-switches"

import { ActivityDialog } from "../components/activity-dialog"
import { AdminButton, ReadOnlyNote } from "../components/admin-access"
import { DiscardedNote } from "../components/discarded-note"
import { ResourceList } from "../components/resource-list"
import { ResourcePage, type ResourceScope } from "../components/resource-page"
import { technicianFields, technicianWrite } from "../lib/changes"
import { TODAY_CHOICES } from "../lib/columns"
import { historyHref } from "../lib/history-link"
import { useRefreshAfterEdit } from "../lib/refresh"
import type { TechnicianRecord } from "../lib/resources"
import { useAdminAccess } from "../lib/use-admin-access"
import { useOpenFor } from "../lib/use-open-for"
import { useResourceList } from "../lib/use-resource-list"
import { byLabel, pastConfirmed } from "../lib/focus"
import { technicianColumns, technicianSearch } from "./columns"
import { UnconfirmedLevelsNote } from "./competence"
import { COMPETENCE_CHOICES, competenceColumns, competenceOf } from "./competence-model"
import { adminRecordOf } from "./admin-record"
import { TechnicianRowActions } from "./technician-actions"
import { TechnicianCards } from "./technician-cards"
import { TechnicianFigures } from "./technician-figures"
import { type TechnicianEditing, TechnicianSheet } from "./technician-form"
import { useConfirmLevel } from "./use-confirm-level"

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

/**
 * The Technicians page (`/resources/technicians`): the dealership's roster. An Admin adds and edits technicians, confirms HV
 * levels and deactivates or reactivates them (Task 30b); a Service advisor or a Viewer sees the same list read-only.
 */
export default function TechniciansPage() {
  return (
    <ResourcePage title="Technicians" description="Who works at the dealership, what they are certified for and how booked they are today.">
      {(scope) => <TechnicianList {...scope} />}
    </ResourcePage>
  )
}

function TechnicianList({ dealership, today, phone }: ResourceScope) {
  const access = useAdminAccess("technicians")
  const reasonId = useId()
  const read = useResourceList<TechnicianRecord>("technicians", { dealership, today, view: access.admin ? "admin" : "workshop" })
  const rows = read.rows ?? NO_ROWS
  // HV competence (ADR-029): the schedule carries it to a role, the Admin read to an Admin, with vehicle-aware requirements on.
  const vehicleAware = useVehicleAware()
  const refresh = useRefreshAfterEdit()
  // An open edit belongs to the Admin it was opened by (`adminWriter`): another Admin, or a role that cannot edit, closes it.
  const { adminWriter } = useCurrentUser()
  const writer = adminWriter ?? ""

  // What is open, and for whom: an edit (or a deactivation) closes without saving in the same render as a change to another
  // Admin or to a role that cannot edit (`useOpenFor`), saying so when the new caller is an Admin too.
  const editor = useOpenFor<TechnicianEditing>(writer)
  const activity = useOpenFor<TechnicianRecord>(writer)
  const opener = useRef<HTMLElement | null>(null)
  const addButton = useRef<HTMLButtonElement>(null)

  const saved = (record: AdminTechnicianResponse, title: string, description: string) => {
    toast.add({ type: "success", title, description })
    void refresh(dealership.id)
    return record
  }
  const confirmLevel = useConfirmLevel({
    dealership,
    onDone: (record) => {
      // The confirmed level's button leaves the review note once the list is read again: focus moves on first.
      if (byLabel("HV levels to review")?.contains(document.activeElement)) pastConfirmed(record.id)?.focus()
      return saved(record, "HV level confirmed", `${record.name}: ${record.hvLevel === 0 ? "no HV training" : `HV ${record.hvLevel}`}, confirmed.`)
    },
  })
  const showCompetence = vehicleAware && rows.some((row) => competenceOf(row, today) !== null)
  const columnVisibility = useColumnVisibility(showCompetence)
  const columns = useMemo(() => {
    if (!showCompetence) return technicianColumns
    // After the certifications: what a technician may work on, then whether they take bookings and their day.
    const at = technicianColumns.findIndex((column) => column.id === "certifications") + 1
    return [...technicianColumns.slice(0, at), ...competenceColumns(today), ...technicianColumns.slice(at)]
  }, [showCompetence, today])
  const unconfirmed = showCompetence
    ? rows.filter((row) => competenceOf(row, today)?.confirmed === false).map((row) => ({ id: row.id, name: row.name }))
    : []

  const table = useTable({
    features: dataTableFeatures,
    data: rows,
    // Rows keyed by record, not position: a re-sorted row (a rename) keeps its element, and with it any focus inside.
    getRowId: (row) => row.id,
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

  const rowActions = access.admin
    ? (row: TechnicianRecord) => (
        <TechnicianRowActions
          row={row}
          vehicleAware={vehicleAware}
          historyHref={historyHref(dealership.id, "technician", row.id)}
          onEdit={(target, trigger) => {
            opener.current = trigger
            editor.open({ mode: "edit", id: target.id, name: target.name })
          }}
          onActivity={(target, trigger) => {
            opener.current = trigger
            activity.open(target)
          }}
          onConfirm={confirmLevel.confirm}
        />
      )
    : undefined

  return (
    <>
      <TechnicianFigures rows={read.rows} day={read.day} failed={read.failure !== null} />
      <UnconfirmedLevelsNote
        levels={unconfirmed}
        onConfirm={access.admin ? (id) => rows.find((row) => row.id === id) && confirmLevel.confirm(rows.find((row) => row.id === id)!) : undefined}
        pending={confirmLevel.pending}
      />
      {confirmLevel.dialog}
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
        cards={(page) => <TechnicianCards rows={page} today={showCompetence ? today : null} actions={rowActions} />}
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
            Add technician
          </AdminButton>
        }
        notice={
          access.admin ? (
            editor.discarded || activity.discarded ? (
              <DiscardedNote>The technician you were editing was closed without saving: who is signed in changed.</DiscardedNote>
            ) : null
          ) : (
            <ReadOnlyNote id={reasonId} reason={access.reason} />
          )
        }
        empty={{ title: "No technicians yet", text: "This dealership has no technicians on its roster.", illustration: "empty-technicians" }}
      />
      {access.admin && (
        <>
          <TechnicianSheet
            editing={editor.value}
            open={editor.isOpen}
            onOpenChange={(open) => !open && editor.close()}
            dealership={dealership}
            today={today}
            phone={phone}
            vehicleAware={vehicleAware}
            returnFocus={() => opener.current}
            onSaved={(record, editing) => {
              editor.close()
              saved(
                record,
                editing.mode === "edit" ? "Technician saved" : "Technician added",
                editing.mode === "edit" ? `${record.name}: changes apply to new bookings.` : `${record.name} is on the roster and takes bookings.`
              )
            }}
            onDiscarded={() => {
              editor.close()
              void refresh(dealership.id)
            }}
          />
          <ActivityDialog
            resource="technicians"
            record={activity.value ? adminRecordOf(activity.value) : null}
            fields={technicianFields}
            writeOf={technicianWrite}
            words={(record, off) =>
              off
                ? {
                    title: `Deactivate ${record.name}?`,
                    action: "Deactivate",
                    consequence: `${record.name} stops taking new bookings. Appointments already booked keep ${record.name}, and the board flags them for review.`,
                  }
                : {
                    title: `Reactivate ${record.name}?`,
                    action: "Reactivate",
                    consequence: `${record.name} takes new bookings again. Appointments flagged because ${record.name} was inactive are no longer flagged for that.`,
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
                record.isActive ? "Technician reactivated" : "Technician deactivated",
                record.isActive ? `${record.name} takes new bookings again.` : `${record.name} takes no new bookings. Their appointments stay, flagged for review.`
              )
            }}
          />
        </>
      )}
    </>
  )
}
