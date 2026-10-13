import { useQuery, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useId, useState } from "react"
import { useNavigate } from "react-router-dom"

import { getWorkshopScheduleOptions } from "@/api/@tanstack/react-query.gen"
import type { AppointmentResponse, DealershipResponse } from "@/api/types.gen"
import { SignInPrompt } from "@/components/auth/sign-in-prompt"
import { WriteReason } from "@/components/auth/write-reason"
import { cachedWriteAccess, useCurrentUser, type WriteAccess, writeAccessOf } from "@/hooks/use-current-user"
import { firstOpenDate } from "@/lib/opening-hours"
import { DATE_PARAM, DEALERSHIP_PARAM } from "@/lib/workshop-params"

import { BookingDialog } from "../components/booking-dialog"
import type { BookedExplanation } from "../lib/allocation"
import { useBookedToast } from "./use-booked-toast"

interface BookActionOptions {
  dealership: DealershipResponse
  /** Today on the dealership's calendar (`yyyy-MM-dd`). */
  today: string
  /** Phones: the dialog is a full-screen sheet that ends on its own success state (UI_DESIGN 11.14). */
  fullScreen: boolean
}

/** A Book action's state for this account: unavailable but focusable, with its reason, unless it may book (UI_DESIGN 11.20). */
export interface BookState {
  disabled: boolean
  focusableWhenDisabled: true
  "aria-describedby"?: string
}

export interface BookAction {
  access: WriteAccess
  bookState: BookState
  /**
   * Opens the booking dialog on a day (`yyyy-MM-dd`; today without one), or the sign-in prompt for a visitor, as the cached
   * `/me` decides when it is called (`cachedWriteAccess`), not as the page was last drawn: the dialog exactly when the cache
   * names an account that may book (`cachedWriter`, the account its writes are then bound to); nothing for any other.
   */
  open: (day?: string) => void
  /** The reason every Book action of the page names, on screen; `null` unless the account's role cannot book. */
  reason: ReactNode
  /** The booking dialog and the sign-in prompt, to render once in the page. */
  dialogs: ReactNode
}

/**
 * Booking from a workshop page other than the board (the Overview's quick action, the Calendar's New appointment and its
 * days): the board's own booking dialog, structure untouched, opened on a chosen day, and the board's role rules (UI_DESIGN
 * 11.20). An Admin or Service advisor gets the dialog; a visitor who is not signed in gets the sign-in prompt before
 * anything is typed, and nothing is sent; any other account sees every Book action unavailable, with the reason on screen
 * and named by each. Which of these a press gets is decided as it happens, from the cached `/me`: a press that lands after
 * the identity changed but before the page has drawn the change opens nothing the new caller may not use. A booking's
 * toast (the board's, explained and stacked with vehicle-aware requirements on: `useBookedToast`), and the phone's success
 * state, lead to the board on the booked day.
 */
export function useBookAction({ dealership, today, fullScreen }: BookActionOptions): BookAction {
  const access = writeAccessOf(useCurrentUser())
  const queryClient = useQueryClient()
  const reasonId = useId()
  const navigate = useNavigate()
  // A new session per opening, so every booking starts from a clean form and a new idempotency key.
  const [booking, setBooking] = useState({ session: 0, open: false, initialDate: today })
  const [signInPrompt, setSignInPrompt] = useState(false)

  // The dialog's preferred bay and technician come from a schedule's bays and technicians, which are the same every day;
  // the starting day's is read once the dialog opens (the board shares the cache).
  const schedule = useQuery({
    ...getWorkshopScheduleOptions({ path: { dealershipId: dealership.id }, query: { date: booking.initialDate } }),
    enabled: booking.open,
  })

  const open = (day?: string) => {
    // The caller now, not the one this render was for (the role's reason, if any, is drawn with the new answer).
    const now = cachedWriteAccess(queryClient)
    if (now.state === "allowed") {
      // A past day or a closed one cannot be booked: the dialog starts on the next day the dealership opens.
      const initialDate = firstOpenDate(dealership, day && day >= today ? day : today)
      setBooking((previous) => ({ session: previous.session + 1, open: true, initialDate }))
    } else if (now.state === "sign-in") setSignInPrompt(true)
  }

  const viewOnBoard = (appointment: AppointmentResponse) => {
    const day = appointment.startLocal.slice(0, 10)
    const search = new URLSearchParams({ [DEALERSHIP_PARAM]: dealership.id })
    if (day !== today) search.set(DATE_PARAM, day)
    setBooking((previous) => ({ ...previous, open: false }))
    navigate({ pathname: "/dispatch", search: `?${search}` })
  }

  const showBooked = useBookedToast(today)
  const onBooked = (appointment: AppointmentResponse, explanation?: BookedExplanation | null) => {
    // On a phone the sheet ends on its own success state; wide screens get the board's toast (UI_DESIGN 11.15).
    if (fullScreen) return
    showBooked(appointment, explanation, () => viewOnBoard(appointment))
  }

  return {
    access,
    bookState: {
      disabled: access.state === "checking" || access.state === "denied",
      focusableWhenDisabled: true,
      "aria-describedby": access.state === "denied" ? reasonId : undefined,
    },
    open,
    reason: access.state === "denied" ? <WriteReason id={reasonId} reason={access.reason} /> : null,
    dialogs: (
      <>
        <BookingDialog
          key={booking.session}
          open={booking.open}
          onOpenChange={(isOpen) => setBooking((previous) => ({ ...previous, open: isOpen }))}
          dealership={dealership}
          schedule={schedule.data}
          initialDate={booking.initialDate}
          today={today}
          fullScreen={fullScreen}
          onBooked={onBooked}
          onViewOnBoard={viewOnBoard}
        />
        <SignInPrompt open={signInPrompt} onOpenChange={setSignInPrompt} />
      </>
    ),
  }
}
