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
  /** Renders the booking dialog full-screen on mobile. */
  fullScreen: boolean
}

/** Disabled/aria-describedby props for a Book button when the user cannot book. */
export interface BookState {
  disabled: boolean
  focusableWhenDisabled: true
  "aria-describedby"?: string
}

export interface BookAction {
  access: WriteAccess
  bookState: BookState
  /** Opens the booking dialog or sign-in prompt based on the current cached user identity. */
  open: (day?: string) => void
  /** The reason every Book action of the page names, on screen; `null` unless the account's role cannot book. */
  reason: ReactNode
  /** The booking dialog and the sign-in prompt, to render once in the page. */
  dialogs: ReactNode
}

/**
 * Provides the booking dialog, sign-in prompt, and role-based button state for pages outside the dispatch board.
 */
export function useBookAction({ dealership, today, fullScreen }: BookActionOptions): BookAction {
  const access = writeAccessOf(useCurrentUser())
  const queryClient = useQueryClient()
  const reasonId = useId()
  const navigate = useNavigate()
  const [booking, setBooking] = useState({ session: 0, open: false, initialDate: today })
  const [signInPrompt, setSignInPrompt] = useState(false)

  const schedule = useQuery({
    ...getWorkshopScheduleOptions({ path: { dealershipId: dealership.id }, query: { date: booking.initialDate } }),
    enabled: booking.open,
  })

  const open = (day?: string) => {
    const now = cachedWriteAccess(queryClient)
    if (now.state === "allowed") {
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
