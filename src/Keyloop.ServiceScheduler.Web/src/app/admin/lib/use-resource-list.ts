import { type BaseRecord, useList } from "@refinedev/core"

import type { DealershipResponse } from "@/api/types.gen"
import { useQueryFailure } from "@/hooks/use-query-failure"

import type { ResourceDay, ResourceListResponse, ResourceName } from "./data-provider"
import { type SchedulerHttpError, shownFailure } from "./http-error"

/** One resource list's read, as the list's frame needs it. */
export interface ResourceRead<TRow> {
  /** `undefined` until the first answer. */
  rows: TRow[] | undefined
  /** The day the figures were measured on (its opening window), once read. */
  day: ResourceDay | undefined
  /** The failure to show, kept while Try again reads again; `null` otherwise. */
  failure: unknown
  fetching: boolean
  updatedAt: number
  retry: () => void
}

/**
 * A resource's list for one dealership's day, through Refine core's `useList` and the read-only data provider (ADR-028).
 * The whole list arrives at once (`pagination` off): the page searches, filters, sorts and pages it with TanStack Table.
 * Like the workshop pages it is read again when the window regains focus.
 */
export function useResourceList<TRow extends BaseRecord>(
  resource: ResourceName,
  { dealership, today }: { dealership: DealershipResponse; today: string }
): ResourceRead<TRow> {
  const { result, query } = useList<TRow, SchedulerHttpError>({
    resource,
    pagination: { mode: "off" },
    meta: { dealershipId: dealership.id, date: today },
    queryOptions: { refetchOnWindowFocus: true },
  })
  // Names this read for the kept failure (Refine keys its own query), so another dealership's or day's never shows.
  const failure = useQueryFailure(query, ["resources", resource, dealership.id, today])

  return {
    rows: query.data ? result.data : undefined,
    day: (query.data as ResourceListResponse<TRow> | undefined)?.day,
    failure: failure === null ? null : shownFailure(failure),
    fetching: query.isFetching,
    updatedAt: query.dataUpdatedAt,
    retry: () => void query.refetch(),
  }
}
