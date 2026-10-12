// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/tasks/components/data-table-row-actions.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { Ban, MoreHorizontal, PanelRightOpen } from "lucide-react"
import { use, useId, useRef } from "react"

import { canCancel } from "@/app/dispatch/lib/status"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useWriteAccess } from "@/hooks/use-current-user"

import { type AppointmentRow, rowName } from "../lib/appointments"
import { OpenAppointmentContext, type RowIntent } from "../lib/row-actions"

/**
 * A row's actions, adopted from the template's tasks table: the board's details sheet, and Cancel, which opens the same
 * sheet on its reason field (the same mutation and problem handling as on the board). Work that has started cannot be
 * cancelled, so its Cancel is unavailable. So is it for a role that cannot cancel, with the reason under it (UI_DESIGN
 * 11.20); a visitor who is not signed in gets the sheet's sign-in panel.
 */
export function DataTableRowActions({ row }: { row: AppointmentRow }) {
  const onOpen = use(OpenAppointmentContext)
  const trigger = useRef<HTMLButtonElement>(null)
  const access = useWriteAccess()
  const reasonId = useId()
  const denied = access.state === "denied" || access.state === "checking"
  // The modal sheet takes focus as it opens, and gives it back to this trigger when it closes.
  const open = (intent: RowIntent) => {
    if (trigger.current) onOpen(row, intent, trigger.current)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            ref={trigger}
            type="button"
            variant="ghost"
            size="icon-sm"
            data-row-actions=""
            aria-label={`Actions for ${rowName(row)}`}
            className="cursor-pointer data-popup-open:bg-muted"
          />
        }
      >
        <MoreHorizontal aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={denied ? "w-64" : "w-48"}>
        <DropdownMenuItem className="cursor-pointer pointer-coarse:min-h-11" onClick={() => open("details")}>
          <PanelRightOpen aria-hidden="true" />
          View details
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="cursor-pointer pointer-coarse:min-h-11"
          disabled={!canCancel(row.status) || denied}
          aria-describedby={access.state === "denied" && canCancel(row.status) ? reasonId : undefined}
          onClick={() => open("cancel")}
        >
          <Ban aria-hidden="true" />
          Cancel appointment
        </DropdownMenuItem>
        {/* Outside the dimmed item, so the reason keeps its full contrast; the item names it for screen readers. */}
        {access.state === "denied" && canCancel(row.status) && (
          <p id={reasonId} className="px-2 pb-1.5 text-xs text-pretty text-muted-foreground">
            {access.reason}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
