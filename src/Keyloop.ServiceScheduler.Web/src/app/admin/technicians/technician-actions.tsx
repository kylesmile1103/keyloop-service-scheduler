import { useDataProvider } from "@refinedev/core"
import { BadgeCheck, History, LoaderCircle, MoreHorizontal, Pencil, Power, PowerOff } from "lucide-react"
import { useRef, useState } from "react"
import { Link } from "react-router-dom"

import type { AdminTechnicianResponse, DealershipResponse, TechnicianWriteRequest } from "@/api/types.gen"
import { ProblemAlert } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useWriteMutation } from "@/hooks/use-write-mutation"
import { authRefusalTitle, failureStatus } from "@/lib/problem-details"

import { ConflictPanel } from "../components/conflict-panel"
import { UpcomingWork } from "../components/upcoming-work"
import { type Conflict, conflictOf, resourceTag } from "../lib/admin-api"
import { conflictRows, reapplied, technicianFields, technicianWrite } from "../lib/changes"
import { type SchedulerHttpError, shownFailure } from "../lib/http-error"
import type { TechnicianRecord } from "../lib/resources"
import { adminRecordOf } from "./admin-record"

interface RowActionsProps {
  row: TechnicianRecord
  /** With vehicle-aware requirements on, an unconfirmed level offers Confirm HV level. */
  vehicleAware: boolean
  historyHref: string
  onEdit: (row: TechnicianRecord, trigger: HTMLElement) => void
  onActivity: (row: TechnicianRecord, trigger: HTMLElement) => void
  onConfirm: (row: TechnicianRecord) => void
}

/**
 * A technician's actions for an Admin (UI_DESIGN 11.24, the appointments list's row menu): Edit, Confirm HV level while the
 * level is unconfirmed, Deactivate or Reactivate, and the technician's change history. The trigger is a ghost icon button
 * named for the technician, 44 px on touch.
 */
export function TechnicianRowActions({ row, vehicleAware, historyHref, onEdit, onActivity, onConfirm }: RowActionsProps) {
  const trigger = useRef<HTMLButtonElement>(null)
  const unconfirmed = vehicleAware && row.hvLevelConfirmed === false
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            ref={trigger}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${row.name}`}
            className="cursor-pointer data-popup-open:bg-muted"
          />
        }
      >
        <MoreHorizontal aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem className="cursor-pointer pointer-coarse:min-h-11" onClick={() => trigger.current && onEdit(row, trigger.current)}>
          <Pencil aria-hidden="true" />
          Edit
        </DropdownMenuItem>
        {unconfirmed && (
          <DropdownMenuItem className="cursor-pointer pointer-coarse:min-h-11" onClick={() => onConfirm(row)}>
            <BadgeCheck aria-hidden="true" />
            Confirm HV level
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          variant={row.isActive ? "destructive" : "default"}
          className="cursor-pointer pointer-coarse:min-h-11"
          onClick={() => trigger.current && onActivity(row, trigger.current)}
        >
          {row.isActive ? <PowerOff aria-hidden="true" /> : <Power aria-hidden="true" />}
          {row.isActive ? "Deactivate" : "Reactivate"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLinkItem render={<Link to={historyHref} />} className="cursor-pointer pointer-coarse:min-h-11">
          <History aria-hidden="true" />
          Change history
        </DropdownMenuLinkItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type ActivityVariables = { body: TechnicianWriteRequest; ifMatch: string }

interface ActivityDialogProps {
  /** The technician as the Admin's list showed them; `null` keeps the dialog closed. */
  row: TechnicianRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
  dealership: DealershipResponse
  today: string
  returnFocus: () => HTMLElement | null
  onDone: (saved: AdminTechnicianResponse) => void
}

/**
 * Deactivate or Reactivate a technician (UI_DESIGN 11.24): one dialog, the consequence first. Deactivating previews the
 * upcoming appointments that would be flagged (they keep the technician; nothing moves); the change is the whole record as
 * the list showed it with `isActive` turned, sent with the version the list read. If another Admin saved first, the dialog
 * shows what changed and offers the same action on the record as it is now.
 */
export function ActivityDialog({ row, open, onOpenChange, dealership, today, returnFocus, onDone }: ActivityDialogProps) {
  return (
    <Dialog open={open && row !== null} onOpenChange={onOpenChange}>
      <DialogContent
        finalFocus={() => {
          const target = returnFocus()
          return target?.isConnected ? target : (document.getElementById("content") ?? true)
        }}
        className="gap-4 sm:max-w-lg"
      >
        {row && <ActivityBody key={row.id} row={row} dealership={dealership} today={today} onClose={() => onOpenChange(false)} onDone={onDone} />}
      </DialogContent>
    </Dialog>
  )
}

function ActivityBody({ row, dealership, today, onClose, onDone }: { row: TechnicianRecord; dealership: DealershipResponse; today: string; onClose: () => void; onDone: (saved: AdminTechnicianResponse) => void }) {
  const dataProvider = useDataProvider()
  const record = adminRecordOf(row)
  const deactivating = row.isActive
  const verb = deactivating ? "Deactivate" : "Reactivate"
  const [conflict, setConflict] = useState<Conflict<AdminTechnicianResponse> | null>(null)
  const change = useWriteMutation<AdminTechnicianResponse, SchedulerHttpError, ActivityVariables>({
    writes: "admin",
    mutationFn: async ({ body, ifMatch }: ActivityVariables, write) => {
      const answer = await dataProvider().update({
        resource: "technicians",
        id: row.id,
        variables: body,
        meta: { dealershipId: dealership.id, fetch: write.fetch(), ifMatch },
      })
      return answer.data as unknown as AdminTechnicianResponse
    },
    onSuccess: onDone,
    onError: (error) => setConflict(conflictOf<AdminTechnicianResponse>(shownFailure(error))),
  })
  if (!record) return null
  const opened = technicianWrite(record)
  const mine = { ...opened, isActive: !deactivating }
  const failure = change.error && !conflict ? shownFailure(change.error) : null
  const status = failureStatus(failure)

  const send = (from: AdminTechnicianResponse | null) => {
    const sendWrite = change.begin()
    if (!sendWrite) return
    const body = from ? reapplied(technicianFields, opened, technicianWrite(from), mine) : mine
    setConflict(null)
    sendWrite({ body, ifMatch: resourceTag(from ? from.version : record.version) })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-heading text-lg font-semibold">{`${verb} ${row.name}?`}</DialogTitle>
        <DialogDescription className="text-pretty">
          {deactivating
            ? `${row.name} stops taking new bookings. Appointments already booked keep ${row.name}, and the board flags them for review.`
            : `${row.name} takes new bookings again. Appointments flagged because ${row.name} was inactive are no longer flagged for that.`}
        </DialogDescription>
      </DialogHeader>
      {deactivating && <UpcomingWork dealership={dealership} today={today} resource={{ kind: "technician", id: row.id, name: row.name }} />}
      {conflict && (
        <ConflictPanel
          title={`Someone else changed ${row.name}`}
          rows={conflictRows(technicianFields, opened, technicianWrite(conflict.current), mine)}
          actions={
            <Button type="button" onClick={() => send(conflict.current)} className="cursor-pointer">
              {`${verb} anyway`}
            </Button>
          }
        >
          <p>{`Another Admin saved ${row.name} after this list was read, so nothing was changed.`}</p>
        </ConflictPanel>
      )}
      {failure !== null && (
        <ProblemAlert
          title={status === 401 || status === 403 ? authRefusalTitle(status, `${verb.toLowerCase()} ${row.name}`) : `Couldn’t ${verb.toLowerCase()} ${row.name}`}
          error={failure}
          tone={status && status < 500 ? "warning" : "error"}
        />
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} className="cursor-pointer">
          Cancel
        </Button>
        {!conflict && (
          <Button
            type="button"
            variant={deactivating ? "destructive" : "default"}
            disabled={change.isPending}
            focusableWhenDisabled
            onClick={() => send(null)}
            className="cursor-pointer"
          >
            {change.isPending && <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
            {verb}
          </Button>
        )}
      </DialogFooter>
    </>
  )
}
