import { useDataProvider } from "@refinedev/core"
import { LoaderCircle } from "lucide-react"
import { useRef, useState } from "react"
import { flushSync } from "react-dom"

import type { DealershipResponse } from "@/api/types.gen"
import { ProblemAlert } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog"
import { useWriteMutation } from "@/hooks/use-write-mutation"
import { authRefusalTitle, failureStatus } from "@/lib/problem-details"

import { type Conflict, conflictOf, resourceTag } from "../lib/admin-api"
import { conflictRows, type FieldWords, reapplied } from "../lib/changes"
import { type SchedulerHttpError, shownFailure } from "../lib/http-error"
import { ConflictPanel } from "./conflict-panel"
import { UpcomingWork } from "./upcoming-work"

/** An Admin record a dialog turns on or off: a technician (active) or a bay (in service), with its version. */
interface Switchable {
  id: string
  name: string
  isActive: boolean
  version: number
}

/** The words of the change, both ways: "Deactivate" and "Reactivate", "Take out of service" and "Return to service". */
export interface ActivityWords {
  /** The dialog's title: "Deactivate Ben Okafor?" */
  title: string
  /** The action, on its button: "Deactivate". */
  action: string
  /** What it does, first in the dialog. */
  consequence: string
}

interface ActivityDialogProps<TRecord extends Switchable, TWrite extends { isActive: boolean }> {
  resource: "technicians" | "bays"
  /** The record as the Admin's list showed it, with the version the list read; `null` keeps the dialog closed. */
  record: TRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
  dealership: DealershipResponse
  today: string
  fields: ReadonlyArray<FieldWords<TWrite>>
  /** The whole write state of a record. */
  writeOf: (record: TRecord) => TWrite
  /** The words for turning this record off (when it is on) or on. */
  words: (record: TRecord, turningOff: boolean) => ActivityWords
  returnFocus: () => HTMLElement | null
  onDone: (saved: TRecord) => void
}

/**
 * Deactivate or reactivate a technician, take a bay out of service or back (UI_DESIGN 11.24): one dialog, the consequence
 * first. Turning a resource off previews the upcoming appointments that would be flagged (they keep it; nothing moves). The
 * change is the whole record as the list showed it with `isActive` turned, sent as a write bound to the Admin with the
 * version the list read. If another Admin saved first, nothing changed: the dialog shows the fields that differ and offers
 * the same action on the record as it is now ("Deactivate anyway").
 */
export function ActivityDialog<TRecord extends Switchable, TWrite extends { isActive: boolean }>({
  open,
  onOpenChange,
  returnFocus,
  ...props
}: ActivityDialogProps<TRecord, TWrite>) {
  const { record } = props
  return (
    <Dialog open={open && record !== null} onOpenChange={onOpenChange}>
      <DialogContent
        finalFocus={() => {
          const target = returnFocus()
          return target?.isConnected ? target : (document.getElementById("content") ?? true)
        }}
        className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto sm:max-w-lg"
      >
        {record && <ActivityBody key={record.id} {...props} record={record} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

type Variables<TWrite> = { body: TWrite; ifMatch: string }

function ActivityBody<TRecord extends Switchable, TWrite extends { isActive: boolean }>({
  resource,
  record,
  dealership,
  today,
  fields,
  writeOf,
  words,
  onDone,
  onClose,
}: Omit<ActivityDialogProps<TRecord, TWrite>, "open" | "onOpenChange" | "returnFocus"> & { record: TRecord; onClose: () => void }) {
  const dataProvider = useDataProvider()
  const turningOff = record.isActive
  const { title, action, consequence } = words(record, turningOff)
  const [conflict, setConflict] = useState<Conflict<TRecord> | null>(null)
  // The footer's action and the comparison's "anyway" take themselves away: focus moves through Cancel, which stays, then to
  // the comparison (a 412) or back to the action (a retry), so it never falls to the dialog itself (UI_DESIGN 11.24).
  const cancelRef = useRef<HTMLButtonElement>(null)
  const actionRef = useRef<HTMLButtonElement>(null)
  const conflictRef = useRef<HTMLElement>(null)
  const change = useWriteMutation<TRecord, SchedulerHttpError, Variables<TWrite>>({
    writes: "admin",
    mutationFn: async ({ body, ifMatch }, write) => {
      const answer = await dataProvider().update({
        resource,
        id: record.id,
        variables: body,
        meta: { dealershipId: dealership.id, fetch: write.fetch(), ifMatch },
      })
      return answer.data as unknown as TRecord
    },
    onSuccess: onDone,
    onError: (error) => {
      const stale = conflictOf(shownFailure(error)) as Conflict<TRecord> | null
      if (!stale) return setConflict(null)
      cancelRef.current?.focus()
      flushSync(() => setConflict(stale))
      conflictRef.current?.focus()
    },
  })
  const opened = writeOf(record)
  const mine = { ...opened, isActive: !turningOff }
  const failure = change.error && !conflict ? shownFailure(change.error) : null
  const status = failureStatus(failure)

  const send = (from: TRecord | null) => {
    const sendWrite = change.begin()
    if (!sendWrite) return
    const body = from ? reapplied(fields, opened, writeOf(from), mine) : mine
    if (conflict) {
      cancelRef.current?.focus()
      flushSync(() => setConflict(null))
      actionRef.current?.focus()
    }
    sendWrite({ body, ifMatch: resourceTag(from ? from.version : record.version) })
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <DialogTitle className="font-heading text-lg font-semibold">{title}</DialogTitle>
        <DialogDescription className="text-pretty">{consequence}</DialogDescription>
      </div>
      {turningOff && (
        <UpcomingWork dealership={dealership} today={today} resource={{ kind: resource === "technicians" ? "technician" : "bay", id: record.id, name: record.name }} />
      )}
      {conflict && (
        <ConflictPanel
          ref={conflictRef}
          title={`Someone else changed ${record.name}`}
          rows={conflictRows(fields, opened, writeOf(conflict.current), mine)}
          actions={
            <Button type="button" onClick={() => send(conflict.current)} className="cursor-pointer">
              {`${action} anyway`}
            </Button>
          }
        >
          <p>{`Another Admin saved ${record.name} after this list was read, so nothing was changed.`}</p>
        </ConflictPanel>
      )}
      {failure !== null && (
        <ProblemAlert
          title={status === 401 || status === 403 ? authRefusalTitle(status, `${action.toLowerCase()} ${record.name}`) : `Couldn’t ${action.toLowerCase()} ${record.name}`}
          error={failure}
          tone={status && status < 500 ? "warning" : "error"}
        />
      )}
      <DialogFooter>
        <Button ref={cancelRef} type="button" variant="outline" onClick={onClose} className="cursor-pointer">
          Cancel
        </Button>
        {!conflict && (
          <Button
            ref={actionRef}
            type="button"
            variant={turningOff ? "destructive" : "default"}
            disabled={change.isPending}
            focusableWhenDisabled
            onClick={() => send(null)}
            className="cursor-pointer"
          >
            {change.isPending && <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
            {action}
          </Button>
        )}
      </DialogFooter>
    </>
  )
}
