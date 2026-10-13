import { type KeyboardEvent, useEffect, useRef } from "react"

import type { BoardAppointment } from "../lib/schedule"
import { AppointmentDetails } from "./appointment-details"

interface AppointmentInspectorProps {
  /** The selected booking, as the board shows it. */
  appointment: BoardAppointment
  dealershipId: string
  /** The board's date (its schedule query is refreshed after a change). */
  date: string
  timeZone: string
  /** The close button and Escape. */
  onClose: () => void
  /** Called once this appointment is cancelled: its block is about to leave the board, and the inspector closes. */
  onCancelled: (appointmentId: string) => void
}

/**
 * The docked inspector (UI_DESIGN 11.14): from 1280 px a booking's details sit on the right of the board, in a
 * complementary landmark named "Appointment details", with no scrim, blur or focus trap, so the board stays usable beside
 * it. Choosing another booking swaps the content in place; the close button and Escape close it. It sticks below the top
 * of the window while the page scrolls and scrolls inside itself. Focus moves to the service's heading when it opens and
 * on each swap; the page returns focus to the booking's block when it closes (or to the board once the block is gone).
 */
export function AppointmentInspector({ appointment, dealershipId, date, timeZone, onClose, onCancelled }: AppointmentInspectorProps) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // Without scrolling: the inspector is beside the block that was chosen, so its heading is already in view.
    titleRef.current?.focus({ preventScroll: true })
  }, [appointment.id])

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return
    event.preventDefault()
    onClose()
  }

  return (
    <aside
      aria-label="Appointment details"
      data-slot="appointment-inspector"
      onKeyDown={onKeyDown}
      className="sticky top-4 flex max-h-[calc(100svh-2rem)] min-w-0 self-start flex-col overflow-hidden rounded-xl bg-card text-sm text-card-foreground shadow-xs ring-1 ring-foreground/10 duration-200 animate-in fade-in-0 slide-in-from-right-2"
    >
      <AppointmentDetails
        key={appointment.id}
        appointment={appointment}
        open
        presentation="inspector"
        dealershipId={dealershipId}
        date={date}
        timeZone={timeZone}
        titleRef={titleRef}
        reasonRef={reasonRef}
        onClose={onClose}
        onDone={() => onCancelled(appointment.id)}
      />
    </aside>
  )
}
