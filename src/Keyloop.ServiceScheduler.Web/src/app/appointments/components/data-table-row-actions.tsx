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

/** Row action menu for viewing appointment details or starting a cancellation. */
export function DataTableRowActions({ row }: { row: AppointmentRow }) {
  const onOpen = use(OpenAppointmentContext)
  const trigger = useRef<HTMLButtonElement>(null)
  const access = useWriteAccess()
  const reasonId = useId()
  const denied = access.state === "denied" || access.state === "checking"
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
        {access.state === "denied" && canCancel(row.status) && (
          <p id={reasonId} className="px-2 pb-1.5 text-xs text-pretty text-muted-foreground">
            {access.reason}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
