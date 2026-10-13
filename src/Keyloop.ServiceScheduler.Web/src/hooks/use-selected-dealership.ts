import { useQueries } from "@tanstack/react-query"
import { useCallback, useEffect, useRef } from "react"
import { useNavigation, useSearchParams } from "react-router-dom"

import { getWorkshopScheduleOptions } from "@/api/@tanstack/react-query.gen"
import type { DealershipResponse, WorkshopScheduleResponse } from "@/api/types.gen"
import { toast } from "@/components/ui/toast"
import { useNow } from "@/hooks/use-now"
import { todayIn } from "@/lib/calendar-date"
import { nextOpenDate } from "@/lib/opening-hours"
import { DEALERSHIP_PARAM } from "@/lib/workshop-params"

export { DEALERSHIP_PARAM }

/**
 * Syncs the selected dealership with the `?dealership=` URL query parameter.
 * Falls back to `useDefaultDealership` (and notifies on stale IDs) when not navigating.
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

const PROBED = 5

const booked = (schedule: WorkshopScheduleResponse | undefined) =>
  schedule?.bays.some((bay) => bay.appointments.length > 0) ?? false

/**
 * Selects a default dealership when none is in the URL: prefers the first with bookings today,
 * then on its next open day, then open today, then the first in the list.
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
