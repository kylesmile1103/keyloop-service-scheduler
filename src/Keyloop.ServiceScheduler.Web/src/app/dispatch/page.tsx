import { useQuery } from "@tanstack/react-query"
import { Building2, CalendarRange, RotateCw } from "lucide-react"

import { getDealershipsOptions } from "@/api/@tanstack/react-query.gen"
import type { DealershipResponse } from "@/api/types.gen"
import { BaseLayout } from "@/components/layouts/base-layout"
import { ProblemAlert } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { BoardMessage, BoardPlaceholder } from "./components/board-placeholder"
import { type DealershipListStatus, DealershipSelect } from "./components/dealership-select"
import { useSelectedDealership } from "./hooks/use-selected-dealership"
import { hourMarks, openingHoursOn, weekdayIn } from "./lib/opening-hours"

export default function DispatchPage() {
  const dealerships = useQuery(getDealershipsOptions())
  const { selected, select } = useSelectedDealership(dealerships.data)

  // A failed background refresh keeps the list it already has; only a list that never arrived is an error.
  const status: DealershipListStatus = dealerships.data
    ? dealerships.data.length > 0
      ? "ready"
      : "empty"
    : dealerships.isError
      ? "failed"
      : "loading"

  const retry = () => void dealerships.refetch()

  return (
    <BaseLayout
      title="Dispatch Board"
      description="Bays, technicians and booked work for one workshop day."
      actions={
        <DealershipSelect dealerships={dealerships.data} value={selected?.id} onValueChange={select} status={status} />
      }
    >
      <div className="px-4 lg:px-6">
        {selected ? (
          <DealershipDay dealership={selected} />
        ) : dealerships.data ? (
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
      </div>
    </BaseLayout>
  )
}

/** The selected dealership's day, as far as this page draws it yet: its opening hours today, in its own time zone. */
function DealershipDay({ dealership }: { dealership: DealershipResponse }) {
  const hours = openingHoursOn(dealership, weekdayIn(dealership.timeZoneId))

  return (
    <BoardPlaceholder hours={hours ? hourMarks(hours) : undefined} closed={!hours}>
      <BoardMessage icon={CalendarRange} title={dealership.name}>
        {hours ? (
          <>
            <p className="tabular-nums">{`Open today ${hours.opensAt}–${hours.closesAt} (${dealership.timeZoneId}).`}</p>
            <p>Bays, technicians and the day’s appointments appear here.</p>
          </>
        ) : (
          <p>{`Closed today (${dealership.timeZoneId}).`}</p>
        )}
      </BoardMessage>
    </BoardPlaceholder>
  )
}
