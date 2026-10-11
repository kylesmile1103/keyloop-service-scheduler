import { useQuery } from "@tanstack/react-query"
import { Building2, RotateCw } from "lucide-react"
import { type ReactNode, useMemo, useRef, useState } from "react"

import { getDealershipsOptions, getWorkshopScheduleOptions } from "@/api/@tanstack/react-query.gen"
import type { DealershipResponse } from "@/api/types.gen"
import { BaseLayout } from "@/components/layouts/base-layout"
import { ProblemAlert } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

import { AppointmentSheet } from "./components/appointment-sheet"
import { BoardMessage, BoardPlaceholder } from "./components/board-placeholder"
import { type DealershipListStatus, DealershipSelect } from "./components/dealership-select"
import { DispatchToolbar } from "./components/dispatch-toolbar"
import { KpiStrip } from "./components/kpi-strip"
import { ScheduleBoard } from "./components/schedule-board"
import { useBoardParams } from "./hooks/use-board-params"
import { useNow } from "./hooks/use-now"
import { useSelectedDealership } from "./hooks/use-selected-dealership"
import { todayIn } from "./lib/calendar-date"
import { type BoardAppointment, buildLanes, type LaneMode } from "./lib/schedule"

/** How often the board reads its schedule again while auto-refresh is on (SYSTEM_DESIGN §15). */
const AUTO_REFRESH_MS = 5000

export default function DispatchPage() {
  const dealerships = useQuery(getDealershipsOptions())
  const { selected, select } = useSelectedDealership(dealerships.data)
  const isMobile = useIsMobile()

  // A failed background refresh keeps the list it already has; only a list that never arrived is an error.
  const status: DealershipListStatus = dealerships.data
    ? dealerships.data.length > 0
      ? "ready"
      : "empty"
    : dealerships.isError
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
    <BaseLayout title="Dispatch Board" description="Bays, technicians and booked work for one workshop day.">
      <div className="flex min-w-0 flex-col gap-4 px-4 md:gap-5 lg:px-6">
        {selected ? (
          <DealershipDay dealership={selected} dealershipSelect={dealershipSelect} agenda={isMobile} />
        ) : (
          <>
            <DispatchToolbar dealershipSelect={dealershipSelect} />
            {dealerships.data ? (
              <BoardPlaceholder>
                <BoardMessage
                  icon={Building2}
                  title="No dealerships yet"
                  action={
                    <Button type="button" variant="outline" size="sm" onClick={retry} disabled={dealerships.isFetching}>
                      <RotateCw aria-hidden="true" className={cn(dealerships.isFetching && "animate-spin")} />
                      Check again
                    </Button>
                  }
                >
                  <p>There are no dealerships to schedule. Once one is set up, it appears here.</p>
                </BoardMessage>
              </BoardPlaceholder>
            ) : dealerships.isError ? (
              <BoardPlaceholder>
                <ProblemAlert
                  title="Couldn’t load dealerships"
                  error={dealerships.error}
                  onRetry={retry}
                  retrying={dealerships.isFetching}
                  className="max-w-xl"
                />
              </BoardPlaceholder>
            ) : (
              <>
                <p role="status" className="sr-only">
                  Loading dealerships…
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
  /** The phone presentation (agenda, bottom sheets, Filters sheet). */
  agenda: boolean
}

/**
 * One dealership's day: the toolbar, the day summary, the board in the chosen lane view and the details sheet. The day and
 * the lane view live in the address (`?date=`, `?lanes=`), so a link reopens the same board; there is one schedule query,
 * which both lane views and both presentations draw from.
 */
function DealershipDay({ dealership, dealershipSelect, agenda }: DealershipDayProps) {
  const now = useNow()
  const timeZone = dealership.timeZoneId
  const today = todayIn(timeZone, now)
  const { date, mode, setDate, setMode } = useBoardParams(today)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  const [selection, setSelection] = useState<Selection | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const board = useRef<HTMLDivElement>(null)

  const refetchInterval = autoRefresh ? AUTO_REFRESH_MS : false
  const schedule = useQuery({
    ...getWorkshopScheduleOptions({ path: { dealershipId: dealership.id }, query: { date } }),
    refetchInterval,
    refetchOnWindowFocus: true,
  })

  const allLanes = useMemo(() => (schedule.data ? buildLanes(schedule.data, mode) : []), [schedule.data, mode])
  const lanes = allLanes.filter((lane) => !hidden.has(lane.id))
  const current = selection?.dealershipId === dealership.id ? selection : null

  const openDetails = (appointment: BoardAppointment, element: HTMLElement) => {
    opener.current = element
    setSelection({ appointment, dealershipId: dealership.id, open: true })
  }

  const boardFor = (laneMode: LaneMode) => (
    <ScheduleBoard
      ref={board}
      dealership={dealership}
      date={date}
      today={today}
      mode={laneMode}
      schedule={schedule}
      lanes={lanes}
      laneCount={allLanes.length}
      onShowAllLanes={() => setHidden(new Set())}
      onDateChange={setDate}
      agenda={agenda}
      now={now}
      selectedId={current?.open ? current.appointment.id : null}
      onSelect={openDetails}
    />
  )

  return (
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
      />
      <KpiStrip
        dealershipId={dealership.id}
        date={date}
        today={today}
        timeZone={timeZone}
        schedule={schedule.data}
        failed={!schedule.data && schedule.isError}
        now={now}
        refetchInterval={refetchInterval}
      />
      <TabsContent value="bays">{mode === "bays" && boardFor("bays")}</TabsContent>
      <TabsContent value="technicians">{mode === "technicians" && boardFor("technicians")}</TabsContent>
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
  )
}
