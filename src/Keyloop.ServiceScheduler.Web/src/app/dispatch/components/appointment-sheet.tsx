import { useRef } from "react"

import { Sheet, SheetContent } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

import type { BoardAppointment } from "../lib/schedule"
import { AppointmentDetails } from "./appointment-details"

interface AppointmentSheetProps {
  /** The appointment as the board shows it; kept while the sheet animates closed. */
  appointment: BoardAppointment | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Side sheet on wide screens, bottom sheet on phones. */
  side: "right" | "bottom"
  dealershipId: string
  /** The board's date (its schedule query is refreshed after a change). */
  date: string
  timeZone: string
  /** Where focus goes when the sheet closes: the block that opened it, or the board when the block is gone. */
  returnFocus: () => HTMLElement | null
  /** Called once the appointment is cancelled, before the sheet closes (its block is about to leave the board). */
  onCancelled?: () => void
  /** Initial focus target when the sheet opens (`title` by default, or `reason` when opened to cancel). */
  initialFocus?: "title" | "reason"
}

/** Modal sheet displaying appointment details on screens narrower than the docked inspector or on non-board views. */
export function AppointmentSheet({
  appointment,
  open,
  onOpenChange,
  side,
  dealershipId,
  date,
  timeZone,
  returnFocus,
  onCancelled,
  initialFocus = "title",
}: AppointmentSheetProps) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  return (
    <Sheet open={open && appointment !== null} onOpenChange={onOpenChange}>
      <SheetContent
        ref={popupRef}
        side={side}
        initialFocus={() => (initialFocus === "reason" ? reasonRef.current : null) ?? titleRef.current ?? true}
        finalFocus={() => {
          if (focusInOtherDialog(popupRef.current)) return false
          const target = returnFocus()
          return target?.isConnected ? target : (document.getElementById("content") ?? true)
        }}
        className={cn("gap-0 p-0 *:data-[slot=sheet-close]:pointer-coarse:size-11", side === "right" && "w-full")}
      >
        {appointment && (
          <AppointmentDetails
            key={appointment.id}
            appointment={appointment}
            open={open}
            presentation={side}
            dealershipId={dealershipId}
            date={date}
            timeZone={timeZone}
            titleRef={titleRef}
            reasonRef={reasonRef}
            confirming={initialFocus === "reason"}
            onDone={() => {
              onCancelled?.()
              onOpenChange(false)
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

/** Whether focus is in a dialog other than `popup`, which then keeps it. */
function focusInOtherDialog(popup: HTMLElement | null): boolean {
  const active = document.activeElement
  return active instanceof HTMLElement && !popup?.contains(active) && active.closest('[role="dialog"]') !== null
}
