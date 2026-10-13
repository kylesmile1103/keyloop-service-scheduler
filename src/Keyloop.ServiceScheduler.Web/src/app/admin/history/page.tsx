import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { BadgeCheck, History, type LucideIcon, Pencil, Plus, Power, PowerOff, RotateCw, Scale } from "lucide-react"
import { useEffect, useId, useRef } from "react"
import { Link, useSearchParams } from "react-router-dom"

import { getServiceTypesOptions } from "@/api/@tanstack/react-query.gen"
import type { AdminHistoryItem, AdminPolicyResponse, BayWriteRequest, DealershipResponse, ServiceTypeResponse, TechnicianWriteRequest } from "@/api/types.gen"
import { IllustratedState } from "@/components/illustrated-state"
import { ProblemAlert } from "@/components/problem-alert"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDay, todayIn } from "@/lib/calendar-date"
import { formatLocalTime } from "@/lib/local-time"
import { cachedCapabilities } from "@/lib/session"
import { cn } from "@/lib/utils"
import { declarerName } from "@/lib/vehicle-aware"

import { ReadOnlyNote } from "../components/admin-access"
import { ResourcePage, type ResourceScope } from "../components/resource-page"
import { bayFields, changesBetween, type FieldChange, technicianFields } from "../lib/changes"
import { adminHistoryPages } from "../lib/admin-reads"
import { historyHref } from "../lib/history-link"
import { useAdminAccess } from "../lib/use-admin-access"
import { ruleChanges, ruleChangeWords } from "../policy/rule-words"

type Kind = AdminHistoryItem["resourceKind"]
const KINDS: ReadonlyArray<{ value: Kind | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "technician", label: "Technicians" },
  { value: "bay", label: "Bays" },
  { value: "policy", label: "Requirement policy" },
]
const PAGE = 25

const isKind = (value: string | null): value is Kind => value === "technician" || value === "bay" || value === "policy"

/**
 * The Change history page (`/resources/history`, Task 30b, offered to an Admin only): Task 30a's audit of every Admin
 * change at the dealership, newest first: who changed what, when (the dealership's clock), and what changed, field by
 * field (a technician's or bay's state before and after) or rule by rule (a policy's publication). Filtered by kind, or to
 * one technician or bay (the row menu's *Change history*), with older changes on request. History survives deactivation.
 */
export default function HistoryPage() {
  return (
    <ResourcePage title="Change history" description="Who changed technicians, bays and the requirement policy, when, and what changed.">
      {(scope) => <HistoryView {...scope} />}
    </ResourcePage>
  )
}

function HistoryView(scope: ResourceScope) {
  const access = useAdminAccess("the change history")
  const reasonId = useId()
  if (!access.admin) {
    return (
      <Card className="gap-3 px-4 py-4 sm:px-6">
        <h2 className="flex items-center gap-2 font-heading text-lg font-semibold">
          <History aria-hidden="true" className="size-5 text-muted-foreground" />
          Kept for Admins
        </h2>
        <ReadOnlyNote
          id={reasonId}
          reason="The change history is kept for workshop Admins: who changed technicians, bays and the requirement policy, and what changed."
        />
      </Card>
    )
  }
  return <HistoryFeed {...scope} />
}

function HistoryFeed({ dealership }: ResourceScope) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useSearchParams()
  const kindParam = search.get("kind")
  const kind = isKind(kindParam) ? kindParam : null
  const resourceId = kind && kind !== "policy" ? search.get("resource") : null
  const filterId = useId()
  const services = useQuery(getServiceTypesOptions({ path: { dealershipId: dealership.id } })).data

  const history = useInfiniteQuery({
    ...adminHistoryPages(dealership.id, { ...(kind ? { resourceKind: kind } : {}), ...(resourceId ? { resourceId } : {}), limit: PAGE }),
    enabled: () => cachedCapabilities(queryClient).isAdmin,
  })
  const feedRef = useRef<HTMLDivElement>(null)
  // The last page takes Show older changes away: focus goes to the first change it loaded, not to the page. The page can
  // arrive before or after React draws it, so the hand-off is tried at once and again after each commit until it lands.
  const focusFrom = useRef<number | null>(null)
  const focusLoaded = () => {
    const index = focusFrom.current
    const article = index === null ? undefined : feedRef.current?.querySelectorAll<HTMLElement>("article")[index]
    if (!article) return
    focusFrom.current = null
    article.focus()
  }
  useEffect(focusLoaded)
  const items = history.data?.pages.flatMap((page) => page.items) ?? []
  const resourceName = resourceId ? (items.map(nameOf).find(Boolean) ?? (kind === "bay" ? "This bay" : "This technician")) : null

  const choose = (next: string) => {
    const params = new URLSearchParams({ dealership: dealership.id })
    if (isKind(next)) params.set("kind", next)
    setSearch(params, { replace: true })
  }

  return (
    <section aria-labelledby={filterId} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {resourceName ? (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id={filterId} className="font-heading text-lg font-semibold">{`${resourceName}'s changes`}</h2>
            <Link to={historyHref(dealership.id)} className="rounded-sm text-sm font-semibold text-signal underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center">
              Show every change
            </Link>
          </div>
        ) : (
          <h2 id={filterId} className="sr-only">
            Changes to show
          </h2>
        )}
        {!resourceName && (
          <RadioGroup
            value={kind ?? "all"}
            onValueChange={(next) => typeof next === "string" && choose(next)}
            aria-labelledby={filterId}
            // No fixed heights: the options size the group. On a phone they sit two by two (a wrapped row of a fixed-height
            // segmented control overlapped the feed at 375 px, Codex check of Task 30b); from sm up, one row.
            className="grid w-full grid-cols-2 gap-0.5 rounded-lg bg-muted p-[3px] sm:inline-flex sm:w-fit sm:max-w-full sm:flex-wrap"
          >
            {KINDS.map((option) => (
              <Radio.Root
                key={option.value}
                value={option.value}
                aria-label={option.label}
                className="inline-flex min-h-[34px] cursor-pointer items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none hover:not-data-checked:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:bg-signal data-checked:text-signal-foreground data-checked:shadow-xs pointer-coarse:min-h-11"
              >
                {option.label}
              </Radio.Root>
            ))}
          </RadioGroup>
        )}
      </div>

      {!history.data && history.error ? (
        <Card className="py-0">
          <ProblemAlert title="Couldn’t load the change history" error={history.error} onRetry={() => void history.refetch()} retrying={history.isFetching} className="m-4" />
        </Card>
      ) : !history.data ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <p role="status" className="sr-only">
            Loading the change history…
          </p>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="py-0">
          <IllustratedState illustration="empty-schedule" title="No changes yet" level={2}>
            <p>{resourceName ? `Nobody has changed ${resourceName} since changes were recorded.` : "Edits to technicians, bays and the requirement policy appear here as they are saved."}</p>
          </IllustratedState>
        </Card>
      ) : (
        <div ref={feedRef} role="feed" aria-label="Changes" aria-busy={history.isFetchingNextPage} className="flex flex-col gap-2">
          {items.map((item, index) => (
            <Entry key={item.id} item={item} dealership={dealership} services={services} position={index + 1} total={history.hasNextPage ? -1 : items.length} />
          ))}
        </div>
      )}

      {history.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          className="cursor-pointer self-start"
          disabled={history.isFetchingNextPage}
          focusableWhenDisabled
          onClick={async () => {
            const loaded = items.length
            const result = await history.fetchNextPage()
            if (result.hasNextPage) return
            focusFrom.current = loaded
            focusLoaded()
          }}
        >
          <RotateCw aria-hidden="true" className={history.isFetchingNextPage ? "animate-spin motion-reduce:animate-none" : undefined} />
          Show older changes
        </Button>
      )}
    </section>
  )
}

const isPolicy = (value: AdminHistoryItem["after"] | null): value is AdminPolicyResponse => value !== null && "rules" in value
const isTechnician = (value: AdminHistoryItem["after"] | null): value is TechnicianWriteRequest => value !== null && "employeeNumber" in value
const isBay = (value: AdminHistoryItem["after"] | null): value is BayWriteRequest => value !== null && "capabilities" in value && !("rules" in value)

/** The technician's or bay's name, from its state after (or before) the change; the policy has none. */
function nameOf(item: AdminHistoryItem): string | null {
  for (const state of [item.after, item.before]) if (state && "name" in state) return state.name
  return null
}

const ACTIONS: Record<AdminHistoryItem["action"], { icon: LucideIcon; technician: string; bay: string }> = {
  create: { icon: Plus, technician: "added", bay: "added" },
  edit: { icon: Pencil, technician: "edited", bay: "edited" },
  deactivate: { icon: PowerOff, technician: "deactivated", bay: "taken out of service" },
  reactivate: { icon: Power, technician: "reactivated", bay: "back in service" },
  "confirm-hv": { icon: BadgeCheck, technician: "HV level confirmed", bay: "confirmed" },
  publish: { icon: Scale, technician: "published", bay: "published" },
}

/** "Ben Okafor edited", "Bay 4 - EV taken out of service", "Requirement policy version 3 published". */
function titleOf(item: AdminHistoryItem): string {
  if (item.resourceKind === "policy") return `Requirement policy version ${isPolicy(item.after) ? item.after.version : ""} published`
  const name = nameOf(item) ?? (item.resourceKind === "bay" ? "A bay" : "A technician")
  if (item.action === "confirm-hv") return `${name}'s HV level confirmed`
  return `${name} ${ACTIONS[item.action][item.resourceKind]}`
}

/** What changed, field by field: before and after for an edit, the state for an addition. */
function fieldChanges(item: AdminHistoryItem): FieldChange[] {
  if (isTechnician(item.after)) return changesBetween(technicianFields, isTechnician(item.before) ? item.before : null, item.after)
  if (isBay(item.after)) return changesBetween(bayFields, isBay(item.before) ? item.before : null, item.after)
  return []
}

interface EntryProps {
  item: AdminHistoryItem
  dealership: DealershipResponse
  services: readonly ServiceTypeResponse[] | undefined
  /** Its place in the feed (`aria-posinset`), and how many there are (`-1` while older ones remain). */
  position: number
  total: number
}

/**
 * One change (UI_DESIGN 11.24): an article named by what happened, its action's icon in a tile, when (the dealership's
 * clock) and by whom, then the fields that changed as a small table (*Field*, *Before*, *After*; a new record's state as
 * *Field*, *Value*) or, for a publication, the rules that changed in words.
 */
function Entry({ item, dealership, services, position, total }: EntryProps) {
  const headingId = useId()
  const { icon: Icon } = ACTIONS[item.action]
  const zone = dealership.timeZoneId
  const when = `${formatDay(todayIn(zone, new Date(item.atUtc)), "short")}, ${formatLocalTime(item.atUtc, zone)}`
  const changed = fieldChanges(item)
  const created = item.before === null
  const rules = isPolicy(item.after)
    ? [...ruleChanges(isPolicy(item.before) ? item.before.rules : [], item.after.rules).keys()].sort().map((code) => ({
        code,
        words: ruleChangeWords(
          isPolicy(item.before) ? item.before.rules.find((rule) => rule.code === code) : undefined,
          (item.after as AdminPolicyResponse).rules.find((rule) => rule.code === code),
          services
        ),
      }))
    : []

  return (
    <article
      aria-labelledby={headingId}
      aria-posinset={position}
      aria-setsize={total}
      tabIndex={-1}
      className="flex gap-3 rounded-xl border border-border bg-card p-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-4"
    >
      <span aria-hidden="true" className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-chip", item.action === "deactivate" ? "bg-destructive/10 text-destructive" : "bg-secondary text-secondary-foreground")}>
        <Icon className="size-4.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 id={headingId} className="font-semibold text-pretty">
            {titleOf(item)}
          </h3>
          <p className="text-xs text-muted-foreground tabular-nums">{`${when}, by ${declarerName(item.actor)}`}</p>
        </div>
        {changed.length > 0 && (
          <table className="w-full max-w-2xl border-collapse text-left text-sm">
            <caption className="sr-only">{created ? "Its state when added" : "What changed"}</caption>
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Field
                </th>
                {!created && (
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Before
                  </th>
                )}
                <th scope="col" className="py-1 font-medium">
                  {created ? "Value" : "After"}
                </th>
              </tr>
            </thead>
            <tbody>
              {changed.map((change) => (
                <tr key={change.key} className="border-t border-border align-top">
                  <th scope="row" className="py-1.5 pr-3 font-normal whitespace-nowrap text-muted-foreground">
                    {change.label}
                  </th>
                  {!created && <td className="py-1.5 pr-3 wrap-break-word text-muted-foreground line-through decoration-muted-foreground/60">{change.before}</td>}
                  <td className="py-1.5 font-medium wrap-break-word">{change.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rules.length > 0 && (
          <ul className="flex flex-col gap-1">
            {rules.map((rule) => (
              <li key={rule.code} className="text-pretty">
                <code className="font-mono text-xs tracking-wide">{rule.code}</code>
                <span className="text-muted-foreground">{`: ${rule.words}`}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  )
}
