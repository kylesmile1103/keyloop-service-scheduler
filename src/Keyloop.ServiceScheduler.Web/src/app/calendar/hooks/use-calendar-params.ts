import { useCallback } from "react"
import { useSearchParams } from "react-router-dom"

import { useBoardParams } from "@/app/dispatch/hooks/use-board-params"
import { DATE_PARAM } from "@/lib/workshop-params"

import { type CalendarView, VIEW_PARAM } from "../lib/calendar"

/**
 * The Calendar's view and the day it is anchored on, in the address next to `?dealership=` so a reload or a shared link
 * opens the same week or month: `?view=month` (absent for a week) and `?date=yyyy-MM-dd` (absent for today, the workshop
 * pages' shared day, so the board's day opens its week and the reverse). The date is validated and cleaned as on the board.
 * Moving to another week or month adds a history entry; switching the view replaces it, as the board's lane view does.
 */
export function useCalendarParams(today: string) {
  const { date: anchor } = useBoardParams(today)
  const [searchParams, setSearchParams] = useSearchParams()
  const view: CalendarView = searchParams.get(VIEW_PARAM) === "month" ? "month" : "week"

  /** Changes the view, the anchor or both in one navigation (`null` anchors on today). */
  const show = useCallback(
    (next: { view?: CalendarView; anchor?: string | null }, replace = false) =>
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current)
          if (next.view === "week") params.delete(VIEW_PARAM)
          else if (next.view) params.set(VIEW_PARAM, next.view)
          if (next.anchor === null || next.anchor === today) params.delete(DATE_PARAM)
          else if (next.anchor) params.set(DATE_PARAM, next.anchor)
          return params
        },
        { replace }
      ),
    [setSearchParams, today]
  )

  return {
    view,
    anchor,
    setAnchor: useCallback((next: string | null) => show({ anchor: next }), [show]),
    setView: useCallback((next: CalendarView) => show({ view: next }, true), [show]),
    show,
  }
}
