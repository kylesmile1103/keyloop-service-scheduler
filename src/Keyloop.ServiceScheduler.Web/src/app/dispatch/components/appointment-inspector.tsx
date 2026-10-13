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

/**
 * The inspector's `top` once it sticks (Tailwind `top-4`), and as much room under it, from the window's foot. The page's
 * bottom padding and margin (2rem) bound its cap instead, so it never makes the page longer.
 */
const STICKY_TOP_PX = 16
const BOTTOM_ROOM = "1rem"
const PAGE_FOOT_PX = 32

/**
 * The docked inspector (UI_DESIGN 11.14): from 1280 px a booking's details sit on the right of the board, in a
 * complementary landmark named "Appointment details", with no scrim, blur or focus trap, so the board stays usable beside
 * it. Choosing another booking swaps the content in place; the close button and Escape close it. Focus moves to the
 * service's heading when it opens and on each swap; the page returns focus to the booking's block when it closes (or to
 * the board once the block is gone).
 *
 * It ends inside the window wherever the page is scrolled, so its header and its buttons are always in view and only the
 * part between them scrolls (the cards, then the cancellation's confirm): it starts level with the board's card, sticks 1rem
 * below the top of the window once the page scrolls past that, and ends 1rem above the window's foot (`useFitToWindow`).
 */
export function AppointmentInspector({ appointment, dealershipId, date, timeZone, onClose, onCancelled }: AppointmentInspectorProps) {
  const asideRef = useRef<HTMLElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  useFitToWindow(asideRef)

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
      ref={asideRef}
      aria-label="Appointment details"
      data-slot="appointment-inspector"
      onKeyDown={onKeyDown}
      // The window's height below the inspector's top, less 1rem, and never past the cap (16rem at least). A height, not a
      // maximum: the scrolling part between the header and the buttons takes what is left, and short details leave the
      // room under the cards empty.
      style={{
        height: `max(16rem, min(calc(100dvh - var(--inspector-offset, 1rem) - ${BOTTOM_ROOM}), var(--inspector-cap, 100dvh)))`,
      }}
      // `duration-200` times the entrance; `transition-none` keeps it from also easing every later change of the measured
      // height (a bare duration transitions all properties), which would leave the inspector lagging behind the page's
      // scroll, its foot out of the window for a moment.
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

/**
 * Keeps the inspector inside the window: `--inspector-offset` is where its top is (its place beside the board's card, or
 * the sticky 1rem once the page has scrolled past it), so its height leaves its bottom 1rem above the window's foot, its
 * buttons in view without scrolling the page. `--inspector-cap` stops it growing as the page scrolls beyond the larger of
 * the board's height and the room it had with the page at its top (above the page's own 2rem foot), so its height never
 * makes the page longer (the row's height stays what it was) and scrolling never feeds back into itself. Measured again on
 * scroll, resize and any change of the page's layout, once a frame.
 */
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
