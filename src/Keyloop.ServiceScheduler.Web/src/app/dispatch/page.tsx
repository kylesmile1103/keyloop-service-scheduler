import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, RotateCw } from "lucide-react"
import { type ReactNode, type RefObject, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"

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
import { cachedWriteAccess, useCurrentUser, writeAccessOf } from "@/hooks/use-current-user"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useIsMobile } from "@/hooks/use-mobile"
import { useNow } from "@/hooks/use-now"
import { useQueryFailure } from "@/hooks/use-query-failure"
import { useSelectedDealership } from "@/hooks/use-selected-dealership"
import { todayIn } from "@/lib/calendar-date"
import { firstOpenDate } from "@/lib/opening-hours"
import { cn } from "@/lib/utils"

import { AppointmentInspector } from "./components/appointment-inspector"
import { AppointmentSheet } from "./components/appointment-sheet"
import { BoardPlaceholder } from "./components/board-placeholder"
import { BookingDialog } from "./components/booking-dialog"
import { DispatchToolbar } from "./components/dispatch-toolbar"
import { KpiStrip } from "./components/kpi-strip"
import { ScheduleBoard } from "./components/schedule-board"
import { useBoardParams } from "./hooks/use-board-params"
import { useBookedToast } from "./hooks/use-booked-toast"
import type { BookedExplanation } from "./lib/allocation"
import { type BoardAppointment, buildLanes, type LaneMode, reviewCount, withVisibleWarnings } from "./lib/schedule"

/** Auto-refresh polling interval for the schedule query. */
const AUTO_REFRESH_MS = 5000

/** Minimum viewport width for docking appointment details beside the board. */
const DOCKED_DETAILS = "(min-width: 1280px)"

export default function DispatchPage() {
  const dealershipsOptions = getDealershipsOptions()
  const dealerships = useQuery(dealershipsOptions)
  const dealershipsFailure = useQueryFailure(dealerships, dealershipsOptions.queryKey)
  const { selected, select } = useSelectedDealership(dealerships.data)
  const isMobile = useIsMobile()
  const identityKnown = useCurrentUser().status !== "loading"

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
  /** Caller identity when selected (`CurrentUser.identity`). */
  identity: string
}

interface DealershipDayProps {
  dealership: DealershipResponse
  dealershipSelect: ReactNode
  /** Uses the mobile agenda presentation with bottom sheets and floating Book action. */
  agenda: boolean
}

/** Renders a dealership's daily schedule board, KPI summary, appointment details, and booking dialog. */
function DealershipDay({ dealership, dealershipSelect, agenda }: DealershipDayProps) {
  const now = useNow()
  const timeZone = dealership.timeZoneId
  const today = todayIn(timeZone, now)
  const { date, mode, setDate, setMode } = useBoardParams(today)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  const [selection, setSelection] = useState<Selection | null>(null)
  const [booking, setBooking] = useState({ session: 0, open: false })
  const opener = useRef<HTMLElement | null>(null)
  const board = useRef<HTMLDivElement>(null)
  const currentUser = useCurrentUser()
  const access = writeAccessOf(currentUser)
  const docked = useMediaQuery(DOCKED_DETAILS) && !agenda
  const [signInPrompt, setSignInPrompt] = useState(false)
  const reasonId = useId()
  const bookState = {
    disabled: access.state === "checking" || access.state === "denied",
    focusableWhenDisabled: true,
    "aria-describedby": access.state === "denied" ? reasonId : undefined,
  }

  const refetchInterval = autoRefresh ? AUTO_REFRESH_MS : false
  const scheduleOptions = getWorkshopScheduleOptions({ path: { dealershipId: dealership.id }, query: { date } })
  const schedule = useQuery({ ...scheduleOptions, refetchInterval, refetchOnWindowFocus: true })
  const scheduleFailure = useQueryFailure(schedule, scheduleOptions.queryKey)

  const canSeeWarnings = currentUser.canViewDetails
  const allLanes = useMemo(
    () => (schedule.data ? withVisibleWarnings(buildLanes(schedule.data, mode), canSeeWarnings) : []),
    [schedule.data, mode, canSeeWarnings]
  )
  const lanes = allLanes.filter((lane) => !hidden.has(lane.id))
  // Close selected booking details immediately when caller identity changes.
  if (selection && selection.identity !== currentUser.identity) setSelection(null)
  const current = selection?.dealershipId === dealership.id && selection.identity === currentUser.identity ? selection : null
  const onBoard = new Set(lanes.flatMap((lane) => lane.appointments.map((appointment) => appointment.id)))
  const { bookedId, highlight } = useBookedHighlight(onBoard, board)
  const selectedId = current?.open ? current.appointment.id : null
  const inspected = docked && current?.open ? current.appointment : null
  useInspectorFocus(inspected?.id ?? null, opener, board)

  const openDetails = (appointment: BoardAppointment, element: HTMLElement) => {
    opener.current = element
    setSelection({ appointment, dealershipId: dealership.id, open: true, identity: currentUser.identity })
  }
  const closeDetails = () => setSelection((previous) => (previous ? { ...previous, open: false } : previous))

  const queryClient = useQueryClient()
  const openBooking = () => {
    const now = cachedWriteAccess(queryClient)
    if (now.state === "allowed") setBooking((previous) => ({ session: previous.session + 1, open: true }))
    else if (now.state === "sign-in") setSignInPrompt(true)
  }

  /** Navigates to an appointment's date and highlights it on the board. */
  const viewOnBoard = (appointment: AppointmentResponse) => {
    const day = appointment.startLocal.slice(0, 10)
    if (day !== date) setDate(day)
    highlight(appointment.id, true)
    setBooking((previous) => ({ ...previous, open: false }))
  }

  const showBooked = useBookedToast(today)
  const onBooked = (appointment: AppointmentResponse, explanation?: BookedExplanation | null) => {
    highlight(appointment.id, false)
    if (agenda) return
    showBooked(appointment, explanation, () => viewOnBoard(appointment))
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
      reviewCount={reviewCount(allLanes)}
      onShowAllLanes={() => setHidden(new Set())}
      onDateChange={setDate}
      agenda={agenda}
      now={now}
      selectedId={selectedId}
      details={docked ? "inspector" : "sheet"}
      narrow={inspected !== null}
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
        <div className={cn(inspected && "grid grid-cols-[minmax(0,1fr)_26rem] items-start gap-5")}>
          <div className="min-w-0">
            <TabsContent value="bays" tabIndex={-1}>
              {mode === "bays" && boardFor("bays")}
            </TabsContent>
            <TabsContent value="technicians" tabIndex={-1}>
              {mode === "technicians" && boardFor("technicians")}
            </TabsContent>
          </div>
          {inspected && (
            <AppointmentInspector
              appointment={inspected}
              dealershipId={dealership.id}
              date={date}
              timeZone={timeZone}
              onClose={closeDetails}
              onCancelled={(appointmentId) => {
                if (opener.current?.dataset.appointmentId === appointmentId) opener.current = null
                setSelection((previous) => (previous?.appointment.id === appointmentId ? { ...previous, open: false } : previous))
              }}
            />
          )}
        </div>
        {!docked && (
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
        )}
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

/** Scrolls the inspected appointment into view and restores focus to its trigger or board when closed. */
function useInspectorFocus(inspectedId: string | null, opener: RefObject<HTMLElement | null>, board: RefObject<HTMLElement | null>) {
  const shown = useRef<string | null>(null)
  useLayoutEffect(() => {
    const previous = shown.current
    shown.current = inspectedId
    if (inspectedId !== null) {
      const block = board.current?.querySelector<HTMLElement>(`[data-appointment-id="${inspectedId}"]`)
      block?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
      return
    }
    const active = document.activeElement
    if (previous === null || (active !== null && active !== document.body)) return
    const target = opener.current?.isConnected ? opener.current : board.current
    target?.focus()
  }, [inspectedId, opener, board])
}

/** Highlights a newly booked appointment on the board for 3 seconds and optionally scrolls it into view. */
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
