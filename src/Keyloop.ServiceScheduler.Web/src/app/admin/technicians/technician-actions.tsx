import { BadgeCheck, Pencil, Power, PowerOff } from "lucide-react"

import { type RowAction, RowActions } from "../components/row-actions"
import type { TechnicianRecord } from "../lib/resources"

interface TechnicianRowActionsProps {
  row: TechnicianRecord
  /** With vehicle-aware requirements on, an unconfirmed level offers Confirm HV level. */
  vehicleAware: boolean
  historyHref: string
  onEdit: (row: TechnicianRecord, trigger: HTMLElement) => void
  onActivity: (row: TechnicianRecord, trigger: HTMLElement) => void
  onConfirm: (row: TechnicianRecord) => void
}

/** A technician's menu for an Admin: Edit, Confirm HV level while it is unconfirmed, Deactivate or Reactivate, and the history. */
export function TechnicianRowActions({ row, vehicleAware, historyHref, onEdit, onActivity, onConfirm }: TechnicianRowActionsProps) {
  const actions: RowAction[] = [
    { label: "Edit", icon: Pencil, onSelect: (trigger) => onEdit(row, trigger) },
    ...(vehicleAware && row.hvLevelConfirmed === false ? [{ label: "Confirm HV level", icon: BadgeCheck, onSelect: () => onConfirm(row) }] : []),
    row.isActive
      ? { label: "Deactivate", icon: PowerOff, destructive: true, onSelect: (trigger: HTMLElement) => onActivity(row, trigger) }
      : { label: "Reactivate", icon: Power, onSelect: (trigger: HTMLElement) => onActivity(row, trigger) },
  ]
  return <RowActions id={row.id} name={row.name} actions={actions} historyHref={historyHref} />
}
