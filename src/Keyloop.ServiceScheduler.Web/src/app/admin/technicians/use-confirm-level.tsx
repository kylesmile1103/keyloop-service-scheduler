import { type ReactNode, useRef, useState } from "react"

import type { AdminTechnicianResponse, DealershipResponse } from "@/api/types.gen"
import { ProblemAlert } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog"
import { useWriteMutation } from "@/hooks/use-write-mutation"
import { authRefusalTitle, failureStatus } from "@/lib/problem-details"

import { ConflictPanel } from "../components/conflict-panel"
import { type Conflict, confirmHvLevel, conflictOf, resourceTag } from "../lib/admin-api"
import { conflictRows, technicianFields, technicianWrite } from "../lib/changes"
import type { TechnicianRecord } from "../lib/resources"
import { adminRecordOf } from "./admin-record"

interface ConfirmLevel {
  /** Confirms the row's level as the list showed it, with the version the list read. */
  confirm: (row: TechnicianRecord) => void
  /** Rows whose confirmation is being sent. */
  pending: ReadonlySet<string>
  /** The dialog a stale confirmation opens, with the level as it is now. */
  dialog: ReactNode
}

/**
 * "Confirm HV level" in one action (UI_DESIGN 11.24): a bodyless POST with the version the list showed. If the record
 * changed first (another Admin lowered the level, say), nothing is confirmed: a dialog shows what changed and offers to
 * confirm the level as it is now, which is then a decision taken on what is on screen.
 */
export function useConfirmLevel({ dealership, onDone }: { dealership: DealershipResponse; onDone: (saved: AdminTechnicianResponse) => void }): ConfirmLevel {
  const [stale, setStale] = useState<{ row: TechnicianRecord; conflict: Conflict<AdminTechnicianResponse> } | null>(null)
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [failure, setFailure] = useState<{ name: string; error: unknown } | null>(null)
  // The row each confirmation was sent for, to compare with the record a 412 returns.
  const rowsById = useRef(new Map<string, TechnicianRecord>())
  const confirm = useWriteMutation({
    writes: "admin",
    mutationFn: ({ id, ifMatch }: { id: string; name: string; ifMatch: string }, write) =>
      confirmHvLevel({ dealershipId: dealership.id, id, ifMatch, fetch: write.fetch() }),
    onMutate: ({ id }) => setPending((previous) => new Set(previous).add(id)),
    onSettled: (_data, _error, { id }) =>
      setPending((previous) => {
        const next = new Set(previous)
        next.delete(id)
        return next
      }),
    onSuccess: (saved) => {
      setStale(null)
      setFailure(null)
      onDone(saved)
    },
    onError: (error, variables) => {
      const conflict = conflictOf<AdminTechnicianResponse>(error)
      const row = rowsById.current.get(variables.id)
      if (conflict && row) setStale({ row, conflict })
      else setFailure({ name: variables.name, error })
    },
  })

  const send = (row: TechnicianRecord, version: number) => {
    rowsById.current.set(row.id, row)
    confirm.mutate({ id: row.id, name: row.name, ifMatch: resourceTag(version) })
  }

  const dialog = (
    <>
      <Dialog open={stale !== null} onOpenChange={(open) => !open && setStale(null)}>
        <DialogContent className="gap-4 sm:max-w-lg">
          {stale && (
            <>
              <div className="flex flex-col gap-2">
                <DialogTitle className="font-heading text-lg font-semibold">{`${stale.row.name}'s record changed`}</DialogTitle>
                <DialogDescription className="text-pretty">
                  Another Admin saved this technician after the list was read, so the level was not confirmed. Confirm it as it is now
                  only if that is the level you checked.
                </DialogDescription>
              </div>
              <ConflictPanel
                title="What changed"
                rows={(() => {
                  const shown = technicianWrite(adminRecordOf(stale.row) ?? stale.conflict.current)
                  return conflictRows(technicianFields, shown, technicianWrite(stale.conflict.current), shown)
                })()}
                actions={null}
                showYours={false}
              >
                <p className="text-muted-foreground">As the list showed it, and as it is now.</p>
              </ConflictPanel>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setStale(null)} className="cursor-pointer">
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={confirm.isPending}
                  focusableWhenDisabled
                  onClick={() => send({ ...stale.row, ...stale.conflict.current }, stale.conflict.current.version)}
                  className="cursor-pointer"
                >
                  {stale.conflict.current.hvLevel === 0 ? "Confirm no HV training" : `Confirm HV ${stale.conflict.current.hvLevel}`}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      {failure && (
        <ProblemAlert
          title={(() => {
            const status = failureStatus(failure.error)
            return status === 401 || status === 403 ? authRefusalTitle(status, `confirm ${failure.name}'s level`) : `Couldn’t confirm ${failure.name}'s level`
          })()}
          error={failure.error}
          tone="warning"
        />
      )}
    </>
  )

  return {
    confirm: (row) => {
      const record = adminRecordOf(row)
      if (record) send(row, record.version)
    },
    pending,
    dialog,
  }
}
