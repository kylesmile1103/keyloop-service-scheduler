import { useCallback, useEffect } from "react"
import { useNavigation, useSearchParams } from "react-router-dom"

import { DATE_PARAM } from "@/lib/workshop-params"

import { isCalendarDate } from "../lib/calendar-date"
import type { LaneMode } from "../lib/schedule"

export { DATE_PARAM }

/** The search parameter naming the lane view; without it the lanes are bays. */
export const LANES_PARAM = "lanes"

/**
 * The board's day and lane view, kept in the address next to `?dealership=` so a reload or a shared link opens the same
 * board. Today is the default and leaves the address clean, so a board left open past midnight moves to the new day.
 * Choosing a day adds a history entry (Back returns to the previous day); switching the lane view replaces the entry. A date
 * that is not a real `yyyy-MM-dd` date is dropped from the address in place. As with the dealership, the address is only
 * corrected while no navigation is pending, since writing it is itself a navigation.
 *
 * @param today today's date in the dealership's calendar.
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
