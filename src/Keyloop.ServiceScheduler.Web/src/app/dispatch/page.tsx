import { useQuery } from "@tanstack/react-query"
import { Plus, RotateCw } from "lucide-react"
import { type ReactNode, type RefObject, useEffect, useId, useMemo, useRef, useState } from "react"

import { getDealershipsOptions, getWorkshopScheduleOptions } from "@/api/@tanstack/react-query.gen"
import type { AppointmentResponse, DealershipResponse } from "@/api/types.gen"
import { SignInPrompt } from "@/components/auth/sign-in-prompt"
import { WriteReason } from "@/components/auth/write-reason"
import { type DealershipListStatus, DealershipSelect } from "@/components/dealership-select"
import { FailedState } from "@/components/failed-state"
import { IllustratedState } from "@/components/illustrated-state"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import { useCurrentUser, writeAccessOf } from "@/hooks/use-current-user"
import { useIsMobile } from "@/hooks/use-mobile"
import { useNow } from "@/hooks/use-now"
import { useQueryFailure } from "@/hooks/use-query-failure"
import { useSelectedDealership } from "@/hooks/use-selected-dealership"
import { formatDay, todayIn } from "@/lib/calendar-date"
import { firstOpenDate } from "@/lib/opening-hours"
import { cn } from "@/lib/utils"

import { AppointmentSheet } from "./components/appointment-sheet"
import { BoardPlaceholder } from "./components/board-placeholder"
import { BookingDialog } from "./components/booking-dialog"
import { DispatchToolbar } from "./components/dispatch-toolbar"
import { KpiStrip } from "./components/kpi-strip"
import { ScheduleBoard } from "./components/schedule-board"
import { useBoardParams } from "./hooks/use-board-params"
import { localTime } from "./lib/appointment-text"
import { type BoardAppointment, buildLanes, type LaneMode } from "./lib/schedule"

/** How often the board reads its schedule again while auto-refresh is on (ARCHITECTURE §15). */
const AUTO_REFRESH_MS = 5000

export default function DispatchPage() {
  const dealershipsOptions = getDealershipsOptions()
  const dealerships = useQuery(dealershipsOptions)
  // Kept while Try again reads the list again, so the failure and its focused button stay until the answer.
  const dealershipsFailure = useQueryFailure(dealerships, dealershipsOptions.queryKey)
  const { selected, select } = useSelectedDealership(dealerships.data)
  const isMobile = useIsMobile()
  // The board waits for `/me` as it waits for its first reads (they run side by side), so its write controls appear in
  // their final state: never usable first and then withdrawn, and never a reason that pushes the board down later.
  const identityKnown = useCurrentUser().status !== "loading"

  // A failed background refresh keeps the list it already has; only a list that never arrived is a failure.
  const status: DealershipListStatus = dealerships.data
    ? dealerships.data.length > 0
      ? "ready"
      : "empty"
    : dealershipsFailure !== null
      ? "failed"
      : "loading"

  const retry = () => void dealerships.refetch()
  const dealershipSelect = (
    <DealershipSelect
      dealerships={dealerships.data}
      value={selected?.id}
      onValueChange={select}
      status={status}
      className={cn(isMobile && "w-full data-[size=default]:h-11")}
    />
  )

  return (
    <BaseLayout title="Dispatch board" description="Bays, technicians and booked work for one workshop day." band>
      <div className={cn("flex min-w-0 flex-col gap-4 px-4 md:gap-5 md:px-6 xl:px-8", isMobile && "pb-24")}>
        {selected && identityKnown ? (
          <DealershipDay dealership={selected} dealershipSelect={dealershipSelect} agenda={isMobile} />
        ) : (
          <>
            <DispatchToolbar dealershipSelect={dealershipSelect} />
            {dealerships.data?.length === 0 ? (
              <Card className="py-0">
                <IllustratedState
                  illustration="empty-schedule"
                  level={2}
                  title="No dealerships yet"
                  action={
                    <Button type="button" onClick={retry} disabled={dealerships.isFetching} focusableWhenDisabled>
                      <RotateCw aria-hidden="true" className={cn(dealerships.isFetching && "animate-spin")} />
                      Check again
                    </Button>
                  }
                >
                  <p>There are no dealerships to schedule. Once one is set up, it appears here.</p>
                </IllustratedState>
              </Card>
            ) : !dealerships.data && dealershipsFailure !== null ? (
              <Card className="py-0">
                <FailedState title="Couldn’t load dealerships" error={dealershipsFailure} onRetry={retry} retrying={dealerships.isFetching} />
              </Card>
            ) : (
              <>
                <p role="status" className="sr-only">
                  {selected ? "Checking who is signed in…" : dealerships.data ? "Finding a dealership with work today…" : "Loading dealerships…"}
                </p>
                <BoardPlaceholder loading />
              </>
            )}
          </>
        )}
      </div>
    </BaseLayout>
  )
}

interface Selection {
  appointment: BoardAppointment
  dealershipId: string
  open: boolean
}

interface DealershipDayProps {
  dealership: DealershipResponse
  dealershipSelect: ReactNode
  /** The phone presentation (agenda, bottom sheets, Filters sheet, full-screen booking, floating Book action). */
  agenda: boolean
}

/**
 * One dealership's day: the toolbar, the day summary, the board in the chosen lane view, the details sheet and the booking
 * dialog. The day and the lane view live in the address (`?date=`, `?lanes=`), so a link reopens
 * the same board; there is one schedule query, which both lane views and both presentations draw from.
 *
 * Booking follows the signed-in role (UI_DESIGN 11.20): an Admin or Service advisor books; a visitor who is not signed in
 * gets the sign-in prompt instead of the dialog, before anything is typed; any other account sees every Book action
 * unavailable, with the reason on screen under the toolbar and read with each action.
 */
function DealershipDay({ dealership, dealershipSelect, agenda }: DealershipDayProps) {
  const now = useNow()
  const timeZone = dealership.timeZoneId
  const today = todayIn(timeZone, now)
  const { date, mode, setDate, setMode } = useBoardParams(today)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  const [selection, setSelection] = useState<Selection | null>(null)
  // A new session per opening, so every booking starts from a clean form and a new idempotency key.
  const [booking, setBooking] = useState({ session: 0, open: false })
  const opener = useRef<HTMLElement | null>(null)
  const board = useRef<HTMLDivElement>(null)
  const access = writeAccessOf(useCurrentUser())
  const [signInPrompt, setSignInPrompt] = useState(false)
  const reasonId = useId()
  // Every Book action is unavailable, but keeps focus, while it cannot book; the reason names it for screen readers.
  const bookState = {
    disabled: access.state === "checking" || access.state === "denied",
    focusableWhenDisabled: true,
    "aria-describedby": access.state === "denied" ? reasonId : undefined,
  }

  const refetchInterval = autoRefresh ? AUTO_REFRESH_MS : false
  const scheduleOptions = getWorkshopScheduleOptions({ path: { dealershipId: dealership.id }, query: { date } })
  const schedule = useQuery({ ...scheduleOptions, refetchInterval, refetchOnWindowFocus: true })
  // A day that never loaded stays failed while it is read again (Try again, a refresh), for the board and the figures alike.
  const scheduleFailure = useQueryFailure(schedule, scheduleOptions.queryKey)

  const allLanes = useMemo(() => (schedule.data ? buildLanes(schedule.data, mode) : []), [schedule.data, mode])
  const lanes = allLanes.filter((lane) => !hidden.has(lane.id))
  const current = selection?.dealershipId === dealership.id ? selection : null
  const onBoard = new Set(lanes.flatMap((lane) => lane.appointments.map((appointment) => appointment.id)))
  const { bookedId, highlight } = useBookedHighlight(onBoard, board)

  const openDetails = (appointment: BoardAppointment, element: HTMLElement) => {
    opener.current = element
    setSelection({ appointment, dealershipId: dealership.id, open: true })
  }

  const openBooking = () => {
    if (access.state === "allowed") setBooking((previous) => ({ session: previous.session + 1, open: true }))
    else if (access.state === "sign-in") setSignInPrompt(true)
  }

  /** Shows a booking on the board: its day, then its block or card, scrolled into view with the booked halo. */
  const viewOnBoard = (appointment: AppointmentResponse) => {
    const day = appointment.startLocal.slice(0, 10)
    if (day !== date) setDate(day)
    highlight(appointment.id, true)
    setBooking((previous) => ({ ...previous, open: false }))
  }

  const onBooked = (appointment: AppointmentResponse) => {
    highlight(appointment.id, false)
    // On a phone the sheet ends on its own success state; wide screens get the toast (UI_DESIGN 11.15).
    if (agenda) return
    const day = appointment.startLocal.slice(0, 10)
    const when = `${localTime(appointment.startLocal)}${day === today ? "" : ` on ${formatDay(day, "short")}`}`
    toast.add({
      type: "success",
      title: "Booked",
      description: `${appointment.serviceType.name} at ${when} · ${appointment.bay.name} · ${appointment.technician.name}`,
      actionProps: { children: "View on board", onClick: () => viewOnBoard(appointment) },
    })
  }

  const bookButton = (
    <Button type="button" onClick={openBooking} className="cursor-pointer" {...bookState}>
      <Plus aria-hidden="true" />
      Book appointment
    </Button>
  )

  const boardFor = (laneMode: LaneMode) => (
    <ScheduleBoard
      ref={board}
      dealership={dealership}
      date={date}
      today={today}
      mode={laneMode}
      schedule={schedule}
      failure={scheduleFailure}
      lanes={lanes}
      laneCount={allLanes.length}
      onShowAllLanes={() => setHidden(new Set())}
      onDateChange={setDate}
      agenda={agenda}
      now={now}
      selectedId={current?.open ? current.appointment.id : null}
      bookedId={bookedId}
      emptyAction={date >= today ? bookButton : undefined}
      onSelect={openDetails}
    />
  )

  return (
    <>
      <Tabs value={mode} onValueChange={(value: LaneMode) => setMode(value)} className="gap-4 md:gap-5">
        <DispatchToolbar
          dealershipSelect={dealershipSelect}
          board={{
            dealership,
            date,
            today,
            onDateChange: setDate,
            mode,
            lanes: allLanes,
            hidden,
            onHiddenChange: setHidden,
            autoRefresh,
            onAutoRefreshChange: setAutoRefresh,
          }}
          onBookAppointment={openBooking}
          bookState={bookState}
        />
        {access.state === "denied" && <WriteReason id={reasonId} reason={access.reason} />}
        <KpiStrip
          dealershipId={dealership.id}
          date={date}
          today={today}
          timeZone={timeZone}
          schedule={schedule.data}
          failed={!schedule.data && scheduleFailure !== null}
          now={now}
          refetchInterval={refetchInterval}
        />
        {/* Out of the tab order: the panel holds focusable content (the timeline, its blocks, the agenda's lanes), so Tab goes
            from the toolbar straight to it instead of stopping on a panel that shows no focus (WCAG 2.4.7). */}
        <TabsContent value="bays" tabIndex={-1}>
          {mode === "bays" && boardFor("bays")}
        </TabsContent>
        <TabsContent value="technicians" tabIndex={-1}>
          {mode === "technicians" && boardFor("technicians")}
        </TabsContent>
        <AppointmentSheet
          appointment={current?.appointment ?? null}
          open={current?.open ?? false}
          onOpenChange={(open) => setSelection((previous) => (previous ? { ...previous, open } : previous))}
          side={agenda ? "bottom" : "right"}
          dealershipId={dealership.id}
          date={date}
          timeZone={timeZone}
          returnFocus={() => (opener.current?.isConnected ? opener.current : board.current)}
          onCancelled={() => {
            opener.current = null
          }}
        />
      </Tabs>

      <BookingDialog
        key={booking.session}
        open={booking.open}
        onOpenChange={(open) => setBooking((previous) => ({ ...previous, open }))}
        dealership={dealership}
        schedule={schedule.data}
        initialDate={firstOpenDate(dealership, date >= today ? date : today)}
        today={today}
        fullScreen={agenda}
        onBooked={onBooked}
        onViewOnBoard={viewOnBoard}
      />
      <SignInPrompt open={signInPrompt} onOpenChange={setSignInPrompt} />

      {agenda && (
        // The phone's Book action: Keyloop's cyan, clear of the home indicator (UI_DESIGN 14). The agenda leaves room under it.
        <Button
          type="button"
          variant="accent"
          data-slot="book-fab"
          aria-label="Book appointment"
          onClick={openBooking}
          {...bookState}
          className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 h-14 rounded-full px-5 text-base shadow-lg ring-6 ring-brand-accent/25 pointer-coarse:h-14"
        >
          <Plus aria-hidden="true" className="size-6" />
          Book
        </Button>
      )}
    </>
  )
}

/**
 * The booking to point at on the board: its block or card draws the booked halo for 3 s once it is on screen (and, after
 * "View on board", scrolls into view). A booking on another day waits until the board shows that day.
 */
function useBookedHighlight(onBoard: ReadonlySet<string>, board: RefObject<HTMLElement | null>) {
  const [booked, setBooked] = useState<{ id: string; scroll: boolean } | null>(null)
  const visible = booked !== null && onBoard.has(booked.id)

  useEffect(() => {
    if (!visible || !booked) return
    if (booked.scroll) {
      const element = board.current?.querySelector<HTMLElement>(`[data-appointment-id="${booked.id}"]`)
      element?.scrollIntoView?.({ block: "center", inline: "center" })
    }
    const timer = setTimeout(() => setBooked(null), 3000)
    return () => clearTimeout(timer)
  }, [visible, booked, board])

  return {
    bookedId: visible ? booked.id : null,
    highlight: (id: string, scroll: boolean) => setBooked({ id, scroll }),
  }
}
