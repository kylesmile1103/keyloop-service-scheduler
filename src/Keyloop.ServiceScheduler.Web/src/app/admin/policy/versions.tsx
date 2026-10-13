import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { History, RotateCw } from "lucide-react"
import { useId } from "react"

import type { AdminHistoryItem, AdminPolicyResponse, DealershipResponse, ServiceTypeResponse } from "@/api/types.gen"
import { ProblemAlert } from "@/components/problem-alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDay, todayIn } from "@/lib/calendar-date"
import { formatLocalTime } from "@/lib/local-time"
import { cachedCapabilities } from "@/lib/session"
import { declarerName } from "@/lib/vehicle-aware"

import { adminHistoryPages } from "../lib/admin-reads"
import { ruleChanges, ruleChangeWords } from "./rule-words"

const PAGE = 20

/** A publication's version, from its audit: the policy after it. */
const isPolicy = (value: AdminHistoryItem["after"] | null): value is AdminPolicyResponse => value !== null && "rules" in value && "version" in value

/**
 * The policy's versions (UI_DESIGN 11.24), newest first, from the change history (`resourceKind=policy`): each publication
 * as an article named by its version, when and by whom, and what it changed rule by rule against the version before ("hv-
 * routine: HV 2 to HV 4"). The oldest publication's "before" is the version the dealership started from. Older pages load
 * on request. Admin only, as the API's history is.
 */
export function PolicyVersions({ dealership, current, services }: { dealership: DealershipResponse; current: number | undefined; services: readonly ServiceTypeResponse[] | undefined }) {
  const headingId = useId()
  const queryClient = useQueryClient()
  const history = useInfiniteQuery({
    ...adminHistoryPages(dealership.id, { resourceKind: "policy", resourceId: dealership.id, limit: PAGE }),
    enabled: () => cachedCapabilities(queryClient).isAdmin,
  })
  const items = history.data?.pages.flatMap((page) => page.items) ?? []
  const publications = items.filter((item) => item.action === "publish" && isPolicy(item.after))
  const oldest = publications.at(-1)
  const origin = !history.hasNextPage && oldest && isPolicy(oldest.before) ? oldest.before : null
  const zone = dealership.timeZoneId

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="flex items-center gap-2 font-heading text-lg font-semibold">
        <History aria-hidden="true" className="size-5 text-muted-foreground" />
        Versions
      </h2>
      {!history.data && history.error ? (
        <ProblemAlert title="Couldn’t load the versions" error={history.error} onRetry={() => void history.refetch()} retrying={history.isFetching} />
      ) : !history.data ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <p role="status" className="sr-only">
            Loading the versions…
          </p>
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : (
        <ol className="flex flex-col gap-2">
          {publications.map((item) => {
            const after = item.after as AdminPolicyResponse
            const before = isPolicy(item.before) ? item.before : null
            return (
              <li key={item.id}>
                <Version
                  version={after.version}
                  inUse={after.version === current}
                  line={`Published ${formatDay(todayIn(zone, new Date(item.atUtc)), "short")}, ${formatLocalTime(item.atUtc, zone)}, by ${declarerName(item.actor)}`}
                  changes={changeLines(before?.rules ?? [], after.rules, services)}
                />
              </li>
            )
          })}
          {(origin || publications.length === 0) && (
            <li>
              <Version
                version={origin?.version ?? current ?? 0}
                inUse={(origin?.version ?? current) === current}
                line={publications.length === 0 ? "The version in use. No publication has been recorded here yet." : "The version the dealership started from."}
                changes={[]}
              />
            </li>
          )}
        </ol>
      )}
      {history.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          className="cursor-pointer self-start"
          disabled={history.isFetchingNextPage}
          focusableWhenDisabled
          onClick={() => void history.fetchNextPage()}
        >
          <RotateCw aria-hidden="true" className={history.isFetchingNextPage ? "animate-spin" : undefined} />
          Show older versions
        </Button>
      )}
    </section>
  )
}

function changeLines(before: AdminPolicyResponse["rules"], after: AdminPolicyResponse["rules"], services: readonly ServiceTypeResponse[] | undefined) {
  return [...ruleChanges(before, after).keys()].sort().map((code) => ({
    code,
    words: ruleChangeWords(
      before.find((rule) => rule.code === code),
      after.find((rule) => rule.code === code),
      services
    ),
  }))
}

function Version({ version, inUse, line, changes }: { version: number; inUse: boolean; line: string; changes: Array<{ code: string; words: string }> }) {
  const headingId = useId()
  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 text-sm sm:p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 id={headingId} className="font-heading text-base font-semibold tabular-nums">{`Version ${version}`}</h3>
        {inUse && (
          <Badge variant="secondary" className="font-normal">
            In use
          </Badge>
        )}
        <span className="text-muted-foreground tabular-nums">{line}</span>
      </div>
      {changes.length > 0 && (
        <ul className="flex flex-col gap-1">
          {changes.map((change) => (
            <li key={change.code} className="text-pretty">
              <code className="font-mono text-xs tracking-wide">{change.code}</code>
              <span className="text-muted-foreground">{`: ${change.words}`}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
