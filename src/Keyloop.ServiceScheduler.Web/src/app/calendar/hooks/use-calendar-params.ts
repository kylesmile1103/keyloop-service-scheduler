import { useCallback } from "react"
import { useSearchParams } from "react-router-dom"

import { useBoardParams } from "@/app/dispatch/hooks/use-board-params"
import { DATE_PARAM } from "@/lib/workshop-params"

import { type CalendarView, VIEW_PARAM } from "../lib/calendar"

/** Synchronizes the calendar view (`week` or `month`) and anchor date with URL search parameters. */
export function useCalendarParams(today: string) {
  const { date: anchor } = useBoardParams(today)
  const [searchParams, setSearchParams] = useSearchParams()
  const view: CalendarView = searchParams.get(VIEW_PARAM) === "month" ? "month" : "week"

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
