import { useCallback, useEffect } from "react"
import { useNavigation, useSearchParams } from "react-router-dom"

import { isCalendarDate } from "@/lib/calendar-date"
import { DATE_PARAM } from "@/lib/workshop-params"

import type { LaneMode } from "../lib/schedule"

export { DATE_PARAM }

/** The search parameter naming the lane view; without it the lanes are bays. */
export const LANES_PARAM = "lanes"

/**
 * Syncs the dispatch board's selected date and lane mode (`bays` or `technicians`) with URL search parameters.
 */
export function useBoardParams(today: string) {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigating = useNavigation().state !== "idle"
  const requestedDate = searchParams.get(DATE_PARAM)
  const validDate = requestedDate !== null && isCalendarDate(requestedDate)
  const date = validDate ? requestedDate : today
  const mode: LaneMode = searchParams.get(LANES_PARAM) === "technicians" ? "technicians" : "bays"

  const write = useCallback(
    (name: string, value: string | null, replace: boolean) =>
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (value === null) next.delete(name)
          else next.set(name, value)
          return next
        },
        { replace }
      ),
    [setSearchParams]
  )

  useEffect(() => {
    if (!navigating && requestedDate !== null && !validDate) write(DATE_PARAM, null, true)
  }, [navigating, requestedDate, validDate, write])

  const setDate = useCallback((next: string | null) => write(DATE_PARAM, next === today ? null : next, false), [today, write])
  const setMode = useCallback((next: LaneMode) => write(LANES_PARAM, next === "bays" ? null : next, true), [write])

  return { date, mode, setDate, setMode }
}
