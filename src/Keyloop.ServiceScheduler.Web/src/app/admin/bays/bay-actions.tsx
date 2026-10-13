import { Pencil, Power, PowerOff } from "lucide-react"

import { type RowAction, RowActions } from "../components/row-actions"
import type { BayRecord } from "../lib/resources"

interface BayRowActionsProps {
  row: BayRecord
  historyHref: string
  onEdit: (row: BayRecord, trigger: HTMLElement) => void
  onActivity: (row: BayRecord, trigger: HTMLElement) => void
}

/** A bay's menu for an Admin: Edit, Take out of service or Return to service, and the history. */
export function BayRowActions({ row, historyHref, onEdit, onActivity }: BayRowActionsProps) {
  const actions: RowAction[] = [
    { label: "Edit", icon: Pencil, onSelect: (trigger) => onEdit(row, trigger) },
    row.isActive
      ? { label: "Take out of service", icon: PowerOff, destructive: true, onSelect: (trigger: HTMLElement) => onActivity(row, trigger) }
      : { label: "Return to service", icon: Power, onSelect: (trigger: HTMLElement) => onActivity(row, trigger) },
  ]
  return <RowActions id={row.id} name={row.name} actions={actions} historyHref={historyHref} />
}
