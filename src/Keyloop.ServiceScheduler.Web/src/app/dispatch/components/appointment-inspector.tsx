import { type KeyboardEvent, type RefObject, useEffect, useLayoutEffect, useRef } from "react"

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

/** Sticky top offset (1rem), bottom viewport clearance, and page footer clearance. */
const STICKY_TOP_PX = 16
const BOTTOM_ROOM = "1rem"
const PAGE_FOOT_PX = 32

/**
 * Docked appointment details inspector shown beside the board on wide screens (>=1280px).
 */
export function AppointmentInspector({ appointment, dealershipId, date, timeZone, onClose, onCancelled }: AppointmentInspectorProps) {
  const asideRef = useRef<HTMLElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  useFitToWindow(asideRef)

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true })
  }, [appointment.id])

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return
    event.preventDefault()
    onClose()
  }

  return (
    <aside
      ref={asideRef}
      aria-label="Appointment details"
      data-slot="appointment-inspector"
      onKeyDown={onKeyDown}
      style={{
        height: `max(16rem, min(calc(100dvh - var(--inspector-offset, 1rem) - ${BOTTOM_ROOM}), var(--inspector-cap, 100dvh)))`,
      }}
      className="sticky top-4 flex min-w-0 self-start flex-col overflow-hidden rounded-xl bg-card text-sm text-card-foreground shadow-xs ring-1 ring-foreground/10 transition-none duration-200 animate-in fade-in-0 slide-in-from-right-2"
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

/** Updates `--inspector-offset` and `--inspector-cap` CSS variables so the sticky inspector fits within the viewport. */
function useFitToWindow(aside: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const element = aside.current
    const row = element?.parentElement
    if (!element || !row) return
    let frame = 0
    const fit = () => {
      frame = 0
      const rowTop = row.getBoundingClientRect().top
      const board = row.firstElementChild?.getBoundingClientRect().height ?? 0
      const roomAtTop = window.innerHeight - (rowTop + window.scrollY) - PAGE_FOOT_PX
      element.style.setProperty("--inspector-offset", `${Math.round(Math.max(rowTop, STICKY_TOP_PX))}px`)
      element.style.setProperty("--inspector-cap", `${Math.round(Math.max(board, roomAtTop))}px`)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(fit)
    }
    fit()
    window.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule)
    for (const target of [document.documentElement, row, row.firstElementChild]) if (target) observer?.observe(target)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
      observer?.disconnect()
    }
  }, [aside])
}
