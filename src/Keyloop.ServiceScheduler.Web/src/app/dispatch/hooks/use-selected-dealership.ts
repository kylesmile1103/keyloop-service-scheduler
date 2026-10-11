import { useCallback, useEffect, useRef } from "react"
import { useNavigation, useSearchParams } from "react-router-dom"

import type { DealershipResponse } from "@/api/types.gen"
import { toast } from "@/components/ui/toast"

/** The search parameter that names the board's dealership: `/dispatch?dealership=<id>`. */
export const DEALERSHIP_PARAM = "dealership"

/**
 * The dealership the board shows, kept in the address so a reload or a shared link opens the same workshop.
 *
 * Until the list has loaded nothing is selected. Then the dealership the address names is selected; without one, the first
 * dealership is, and the address is updated in place (no extra history entry). An id that names no dealership (a stale
 * link) is replaced the same way, and a toast says so. Choosing a dealership adds a history entry, so Back returns to the
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
  const selected = requested ?? dealerships?.[0]

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
