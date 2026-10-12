// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/users/page.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { useQuery } from "@tanstack/react-query"
import { RotateCw } from "lucide-react"
import { Fragment, type ReactNode } from "react"

import { getDealershipsOptions } from "@/api/@tanstack/react-query.gen"
import type { DealershipResponse } from "@/api/types.gen"
import { type DealershipListStatus, DealershipSelect } from "@/components/dealership-select"
import { FailedState } from "@/components/failed-state"
import { IllustratedState } from "@/components/illustrated-state"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { useIsMobile } from "@/hooks/use-mobile"
import { useNow } from "@/hooks/use-now"
import { useQueryFailure } from "@/hooks/use-query-failure"
import { useSelectedDealership } from "@/hooks/use-selected-dealership"
import { todayIn } from "@/lib/calendar-date"
import { cn } from "@/lib/utils"

import { FiguresSkeleton, ListSkeleton } from "./resource-list"

/** What a resources page's list is about: the chosen dealership, its today, and the phone presentation. */
export interface ResourceScope {
  dealership: DealershipResponse
  /** Today in the dealership's own calendar, `yyyy-MM-dd`. */
  today: string
  phone: boolean
}

interface ResourcePageProps {
  title: string
  description: string
  /** The list for the chosen dealership; a new one for each dealership. */
  children: (scope: ResourceScope) => ReactNode
}

/**
 * A resources page (the template's users page, without the add-user form: these lists are read-only until Task 30): the
 * dealership choice the workshop pages share (`?dealership=`, the same default), then the dealership's list, measured on
 * its own today. Until a dealership is chosen the page says why: loading, none set up, or the list failed.
 */
export function ResourcePage({ title, description, children }: ResourcePageProps) {
  const dealershipsOptions = getDealershipsOptions()
  const dealerships = useQuery(dealershipsOptions)
  // Kept while Try again reads the list again, so the failure and its focused button stay until the answer.
  const failure = useQueryFailure(dealerships, dealershipsOptions.queryKey)
  const { selected, select } = useSelectedDealership(dealerships.data)
  const phone = useIsMobile()
  const now = useNow()

  const status: DealershipListStatus = dealerships.data
    ? dealerships.data.length > 0
      ? "ready"
      : "empty"
    : failure !== null
      ? "failed"
      : "loading"
  const retry = () => void dealerships.refetch()

  return (
    <BaseLayout title={title} description={description}>
      <div className="flex min-w-0 flex-col gap-4 px-4 md:gap-5 md:px-6 xl:px-8">
        <div className={cn("flex gap-2", phone ? "flex-col" : "flex-wrap items-center")}>
          <DealershipSelect
            dealerships={dealerships.data}
            value={selected?.id}
            onValueChange={select}
            status={status}
            className={cn(phone && "w-full data-[size=default]:h-11")}
          />
        </div>
        {selected ? (
          // A new list per dealership: its rows, filters and sort are its own.
          <Fragment key={selected.id}>{children({ dealership: selected, today: todayIn(selected.timeZoneId, now), phone })}</Fragment>
        ) : dealerships.data?.length === 0 ? (
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
              <p>There are no dealerships to list resources for. Once one is set up, it appears here.</p>
            </IllustratedState>
          </Card>
        ) : !dealerships.data && failure !== null ? (
          <Card className="py-0">
            <FailedState title="Couldn’t load dealerships" error={failure} onRetry={retry} retrying={dealerships.isFetching} />
          </Card>
        ) : (
          <>
            <p role="status" className="sr-only">
              {dealerships.data ? "Finding a dealership with work today…" : "Loading dealerships…"}
            </p>
            <FiguresSkeleton />
            <ListSkeleton phone={phone} />
          </>
        )}
      </div>
    </BaseLayout>
  )
}
