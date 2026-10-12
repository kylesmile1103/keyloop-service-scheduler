import { useQueries } from "@tanstack/react-query"
import { useCallback, useEffect, useRef } from "react"
import { useNavigation, useSearchParams } from "react-router-dom"

import { getWorkshopScheduleOptions } from "@/api/@tanstack/react-query.gen"
import type { DealershipResponse, WorkshopScheduleResponse } from "@/api/types.gen"
import { toast } from "@/components/ui/toast"
import { DEALERSHIP_PARAM } from "@/lib/workshop-params"

import { todayIn } from "../lib/calendar-date"
import { nextOpenDate } from "../lib/opening-hours"
import { useNow } from "./use-now"

export { DEALERSHIP_PARAM }

/**
 * The dealership the board shows, kept in the address so a reload or a shared link opens the same workshop.
 *
 * Until the list has loaded nothing is selected. Then the dealership the address names is selected; without one, a
 * dealership with work to show is (see `useDefaultDealership`), and the address is updated in place (no extra history
 * entry). An id that names no dealership (a stale link) is replaced the same way, and a toast says so. Choosing a dealership adds a history entry, so Back returns to the
 * previous one. Other search parameters (the date, the lane view) are left alone.
 *
 * The address is only corrected while no navigation is pending: writing it is itself a navigation, and would cancel the
 * user's own (a click to another page whose code is still loading when the list arrives).
 */
export function useSelectedDealership(dealerships: readonly DealershipResponse[] | undefined) {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigating = useNavigation().state !== "idle"
  const requestedId = searchParams.get(DEALERSHIP_PARAM)
  const requested = dealerships?.find((dealership) => dealership.id === requestedId)
  const fallback = useDefaultDealership(dealerships, !requested)
  const selected = requested ?? fallback

  const writeId = useCallback(
    (id: string, replace: boolean) =>
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          next.set(DEALERSHIP_PARAM, id)
          return next
        },
        { replace }
      ),
    [setSearchParams]
  )

  // Survives React's development double-run of effects, so a stale link is reported once.
  const reportedStaleId = useRef<string | null>(null)

  useEffect(() => {
    if (navigating || !selected || selected.id === requestedId) return
    if (requestedId && reportedStaleId.current !== requestedId) {
      reportedStaleId.current = requestedId
      toast.add({
        type: "warning",
        title: "Dealership not found",
        description: `The link named a dealership that does not exist. Showing ${selected.name}.`,
      })
    }
    writeId(selected.id, true)
  }, [navigating, requestedId, selected, writeId])

  const select = useCallback((id: string) => writeId(id, false), [writeId])

  return { selected, select }
}

/** How many dealerships the default choice looks at (two schedule reads each); a longer list starts on its first. */
const PROBED = 5

const booked = (schedule: WorkshopScheduleResponse | undefined) =>
  schedule?.bays.some((bay) => bay.appointments.length > 0) ?? false

/**
 * The dealership the board opens on when the address names none: the first (in the API's order, by name) with appointments
 * on today's board, else the first with appointments on its next open day, else the first open today, else the first. The
 * API lists dealerships by name, so without this a demo would open on one with nothing booked. It reads today's schedule
 * and the next open day's for the first few dealerships; the chosen one's today read is the board's own query, so the board
 * opens from the cache. `undefined` until those reads have settled (a failed read counts as nothing booked).
 */
export function useDefaultDealership(dealerships: readonly DealershipResponse[] | undefined, enabled: boolean) {
  const now = useNow(60_000)
  const candidates = (dealerships ?? []).slice(0, dealerships && dealerships.length > 1 ? PROBED : 0)
  const days = candidates.map((dealership) => {
    const today = todayIn(dealership.timeZoneId, now)
    return { today, next: nextOpenDate(dealership, today) }
  })
  const reads = useQueries({
    queries: candidates.flatMap((dealership, index) =>
      [days[index].today, days[index].next]
        .filter((date): date is string => date !== null)
        .map((date) => ({ ...getWorkshopScheduleOptions({ path: { dealershipId: dealership.id }, query: { date } }), enabled }))
    ),
  })

  if (!dealerships || dealerships.length === 0) return undefined
  if (candidates.length === 0) return dealerships[0]
  if (reads.some((read) => read.isPending)) return undefined

  const schedule = (dealership: DealershipResponse, date: string | null) =>
    date === null ? undefined : reads.find((read) => read.data?.dealership.id === dealership.id && read.data.date === date)?.data
  return (
    candidates.find((dealership, index) => booked(schedule(dealership, days[index].today))) ??
    candidates.find((dealership, index) => booked(schedule(dealership, days[index].next))) ??
    candidates.find((dealership, index) => schedule(dealership, days[index].today)?.operatingWindow) ??
    dealerships[0]
  )
}
