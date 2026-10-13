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
  /**
   * Where focus lands when the sheet opens: its title (the details), or the cancellation's reason field when the sheet was
   * opened to cancel (the appointments list's Cancel action), with the confirm already open. An appointment that cannot be
   * cancelled opens on its title.
   */
  initialFocus?: "title" | "reason"
}

/**
 * An appointment's details in a sheet (UI_DESIGN 11.14): on the right of a screen narrower than the docked inspector's
 * 1280 px, from the bottom of a phone, and on the Appointments, Calendar and Overview pages at every width. Modal: the
 * page behind it waits under the scrim until it closes. The content is the inspector's (`AppointmentDetails`).
 */
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
        // A dialog opened over the sheet keeps focus when the sheet closes beneath it (the session dialog, after a refusal
        // that also closed the sheet because the identity changed). Otherwise focus goes back where the sheet came from, or,
        // when that is gone (the view reading its data again after the identity changed), to the page's content rather
        // than wherever the browser would fall back to.
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
