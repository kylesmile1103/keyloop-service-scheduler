import { useEffect, useRef } from "react"

import type { AppointmentResponse } from "@/api/types.gen"
import { toast } from "@/components/ui/toast"
import { useCurrentUser } from "@/hooks/use-current-user"
import { formatDay } from "@/lib/calendar-date"

import type { BookedExplanation } from "../lib/allocation"
import { localTime } from "../lib/appointment-text"

/**
 * The toast a booking ends with on a wide screen (UI_DESIGN 11.15), the same from every page that books (the board, the
 * Overview, the Calendar): what was booked, its time (with the day when it is not today) and View on board. With
 * vehicle-aware requirements on, the booking dialog passes the allocation explained (ADR-029 §4), and the toast then says
 * why this technician and why not the one asked for, stacked and shown for longer. That can name a technician's HV level
 * (role-only data), so an explained toast closes when who is signed in changes, as the details sheet does.
 */
export function useBookedToast(today: string) {
  const identity = useCurrentUser().identity
  const explained = useRef<Array<{ id: string; identity: string }>>([])
  useEffect(() => {
    const stale = explained.current.filter((shown) => shown.identity !== identity)
    if (stale.length === 0) return
    for (const shown of stale) toast.close(shown.id)
    explained.current = explained.current.filter((shown) => shown.identity === identity)
  }, [identity])

  return (appointment: AppointmentResponse, explanation: BookedExplanation | null | undefined, onViewOnBoard: () => void) => {
    const day = appointment.startLocal.slice(0, 10)
    const when = `${localTime(appointment.startLocal)}${day === today ? "" : ` on ${formatDay(day, "short")}`}`
    const summary = `${appointment.serviceType.name} at ${when} · ${appointment.bay.name} · ${appointment.technician.name}`
    const id = toast.add({
      type: "success",
      title: "Booked",
      description: explanation ? (
        <span className="flex flex-col gap-1.5">
          <span>{summary}</span>
          <span className="text-foreground">{explanation.technician}</span>
          {explanation.whyNot.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      ) : (
        summary
      ),
      ...(explanation ? { timeout: 12_000, data: { stacked: true } } : {}),
      actionProps: { children: "View on board", onClick: onViewOnBoard },
    })
    if (explanation) explained.current.push({ id, identity })
  }
}
