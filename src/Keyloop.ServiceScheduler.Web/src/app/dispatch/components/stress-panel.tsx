import { useQuery, useQueryClient } from "@tanstack/react-query"
import { LoaderCircle, Zap } from "lucide-react"
import { useId, useState } from "react"

import { getAvailabilityQueryKey, getServiceTypesOptions, getWorkshopScheduleQueryKey } from "@/api/@tanstack/react-query.gen"
import type { DealershipResponse, GetAvailabilityData } from "@/api/types.gen"
import { CopyButton } from "@/components/copy-button"
import { ProblemAlert } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { withSpan } from "@/lib/telemetry"
import { cn } from "@/lib/utils"

import { alwaysShown, outcomeMeta, outcomeOrder } from "../lib/outcomes"
import {
  fireParallelBookings,
  latency,
  type OutcomeKind,
  outcomeKind,
  type StressOutcome,
  stressBooking,
  tally,
} from "../lib/stress"
import { AvailabilityChips } from "./availability-chips"

const DEFAULT_REQUESTS = 30
const MIN_REQUESTS = 2
const MAX_REQUESTS = 50

interface StressPanelProps {
  dealership: DealershipResponse
  /** The board's day: the panel aims at one of its free starts. */
  date: string
  today: string
  /** Phones: the results as stacked rows instead of a table. */
  compact: boolean
  /** The run's one booking, so the board can point at it. */
  onWinner: (appointmentId: string) => void
}

interface Run {
  /** The board (dealership and day) the run was fired from: its results show only there. */
  board: string
  total: number
  /** In arrival order while running, by request number once done. */
  outcomes: StressOutcome[]
  running: boolean
  /** The `ui.stress_test` trace, when browser tracing is on: every request of the run is in it. */
  traceId?: string
  /** Why the run stopped before every answer was in (the requests themselves never throw). */
  failure?: unknown
}

/** The chosen start, as an object: a run clears the one it fired at, never one chosen since. */
interface Target {
  startUtc: string
}

/**
 * The concurrency proof from the browser (SYSTEM_DESIGN §15, the video's proof moment): N bookings for one slot fired at
 * once through the generated SDK inside a `ui.stress_test` span. For a slot with one free bay and technician the database
 * lets exactly one through and refuses the rest with `409`; the tally shows it live (the 5xx tile always shows, ideally
 * 0), with latency and every answer listed with its copyable trace id. The tiles follow the template's section cards.
 */
export function StressPanel({ dealership, date, today, compact, onWinner }: StressPanelProps) {
  const ids = { heading: useId(), requests: useId(), requestsError: useId(), service: useId(), start: useId() }
  const queryClient = useQueryClient()
  const [requests, setRequests] = useState(String(DEFAULT_REQUESTS))
  const [serviceTypeId, setServiceTypeId] = useState("")
  const [target, setTarget] = useState<Target | null>(null)
  const [run, setRun] = useState<Run | null>(null)

  // The panel aims at the board above it. When the board moves to another day the chosen start is dropped, and at another
  // dealership the chosen service too, so Fire is never aimed at a slot the user can no longer see (and by the time the
  // board comes back, that start may be taken). The number of requests stays. The state is adjusted while rendering (React's
  // pattern for state that follows a prop), so no frame offers Fire at the old start.
  const [shown, setShown] = useState({ dealershipId: dealership.id, date })
  if (shown.dealershipId !== dealership.id || shown.date !== date) {
    setShown({ dealershipId: dealership.id, date })
    setTarget(null)
    if (shown.dealershipId !== dealership.id) setServiceTypeId("")
  }
  const startUtc = target?.startUtc ?? ""
  // A run's results show on the board it was fired from (going back there shows them again).
  const board = `${dealership.id}/${date}`
  const shownRun = run?.board === board ? run : null
  const running = run?.running ?? false
  const serviceTypes = useQuery(getServiceTypesOptions({ path: { dealershipId: dealership.id } }))
  const bookable = (serviceTypes.data ?? []).filter((candidate) => candidate.bookable)
  const service = bookable.find((candidate) => candidate.id === serviceTypeId)

  const n = Number(requests)
  const validCount = Number.isInteger(n) && n >= MIN_REQUESTS && n <= MAX_REQUESTS
  const past = date < today
  const ready = validCount && Boolean(service) && Boolean(startUtc) && !past && !running

  async function fire() {
    if (!service || !ready || !target) return
    const aimed = target
    const slot = { serviceTypeId: service.id, startUtc: aimed.startUtc }
    setRun({ board, total: n, outcomes: [], running: true })
    try {
      const outcomes = await withSpan(
        "ui.stress_test",
        ({ fetch, span }) => {
          const traceId = span.isRecording() ? span.spanContext().traceId : undefined
          setRun((current) => current && { ...current, traceId })
          return fireParallelBookings(n, (index) => stressBooking(index, slot), dealership.id, {
            fetch,
            onSettled: (outcome) => setRun((current) => current && { ...current, outcomes: [...current.outcomes, outcome] }),
          })
        },
        {
          "keyloop.dealership_id": dealership.id,
          "keyloop.service_type_id": slot.serviceTypeId,
          "keyloop.start_utc": slot.startUtc,
          "keyloop.requests": n,
        }
      )
      setRun((current) => current && { ...current, outcomes })
      const winner = outcomes.find((outcome) => outcome.appointmentId)
      if (winner?.appointmentId) onWinner(winner.appointmentId)
    } catch (failure) {
      setRun((current) => current && { ...current, failure })
    } finally {
      setRun((current) => current && { ...current, running: false })
      // Whatever came back, the run's day may have changed (this render's dealership and date, whatever the board shows by
      // now): the winner is on its board, and the slot is gone from every availability read of that day.
      void queryClient.invalidateQueries({ queryKey: getWorkshopScheduleQueryKey({ path: { dealershipId: dealership.id }, query: { date } }) })
      void queryClient.invalidateQueries({
        queryKey: getAvailabilityQueryKey({ path: { dealershipId: dealership.id }, query: { date } as GetAvailabilityData["query"] }),
      })
      // The start is spent; one chosen since stays.
      setTarget((current) => (current === aimed ? null : current))
    }
  }

  return (
    <Card role="region" aria-labelledby={ids.heading} className="gap-0 py-0">
      <CardHeader className="border-b py-4">
        <CardTitle>
          <h2 id={ids.heading} className="font-heading text-lg font-semibold">
            Concurrency test
          </h2>
        </CardTitle>
        <CardDescription className="max-w-prose">
          Fire many bookings at one slot at the same moment. The database lets exactly one through; every other request is
          refused with 409 and nothing is double-booked.
        </CardDescription>
        <CardAction>
          <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-chip bg-secondary text-secondary-foreground">
            <Zap className="size-5" />
          </span>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-5 py-4">
        <div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.requests}>Requests</Label>
            <Input
              id={ids.requests}
              type="number"
              inputMode="numeric"
              min={MIN_REQUESTS}
              max={MAX_REQUESTS}
              value={requests}
              onChange={(event) => setRequests(event.target.value)}
              aria-invalid={!validCount || undefined}
              aria-describedby={!validCount ? ids.requestsError : undefined}
              className="tabular-nums"
            />
            {!validCount && (
              <p id={ids.requestsError} className="text-sm text-destructive">
                {`Choose ${MIN_REQUESTS} to ${MAX_REQUESTS} requests`}
              </p>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={ids.service}>Service</Label>
            <Select
              items={bookable.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
              value={serviceTypeId || null}
              onValueChange={(value) => {
                setServiceTypeId(value ?? "")
                // A start belongs to one service's availability.
                setTarget(null)
              }}
            >
              <SelectTrigger id={ids.service} className="w-full cursor-pointer" aria-busy={serviceTypes.isPending || undefined}>
                <SelectValue placeholder={serviceTypes.isPending ? "Loading services…" : "Choose a service"} />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {bookable.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span id={ids.start} className="text-sm font-medium">
            Slot
            <span className="font-normal text-muted-foreground">{" · a start with 1 bay and 1 tech free shows the proof best"}</span>
          </span>
          {past ? (
            <p className="rounded-chip border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
              Past days take no bookings: choose today or a later day on the board.
            </p>
          ) : (
            <AvailabilityChips
              dealershipId={dealership.id}
              serviceType={service}
              date={date}
              value={startUtc}
              onValueChange={(value) => setTarget({ startUtc: value })}
              labelledBy={ids.start}
            />
          )}
        </div>

        <div>
          <Button type="button" variant="signal" onClick={() => void fire()} disabled={!ready} aria-busy={running || undefined}>
            {running ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Zap aria-hidden="true" />}
            {running ? "Firing…" : validCount ? `Fire ${n} parallel bookings` : "Fire parallel bookings"}
          </Button>
        </div>

        {shownRun && <RunResults run={shownRun} compact={compact} />}
      </CardContent>
    </Card>
  )
}

function RunResults({ run, compact }: { run: Run; compact: boolean }) {
  const rows = tally(run.outcomes)
  const byKind = (kind: OutcomeKind) => run.outcomes.filter((outcome) => outcomeKind(outcome.status) === kind)
  const kinds = outcomeOrder.filter((kind) => alwaysShown.includes(kind) || byKind(kind).length > 0)
  const timing = latency(run.outcomes)
  const ordered = run.running ? run.outcomes : [...run.outcomes].sort((a, b) => a.index - b.index)

  return (
    <div className="flex flex-col gap-4 border-t pt-4">
      {run.failure ? (
        <ProblemAlert title="The concurrency test stopped" error={run.failure}>
          <span>{`${run.outcomes.length} of ${run.total} answers came back. The board and the free starts have been read again.`}</span>
        </ProblemAlert>
      ) : (
        <p role="status" className="text-sm text-muted-foreground tabular-nums">
          {run.running
            ? `Running: ${run.outcomes.length} of ${run.total} answered…`
            : `${run.total} requests answered${timing ? ` in ${timing.max} ms at most` : ""}.`}
        </p>
      )}

      {/* A run that stopped before any answer came back has nothing to count. */}
      {(!run.failure || run.outcomes.length > 0) && (
        <section aria-label="Tally" className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {kinds.map((kind) => {
              const { word, icon: Icon, tile, ink } = outcomeMeta[kind]
              const count = byKind(kind).length
              const labels = rows.filter((row) => kindOfRow(row.label) === kind)
              return (
                <Card key={kind} size="sm" role="group" aria-label={word} className="shadow-xs">
                  <CardHeader>
                    <CardDescription>{word}</CardDescription>
                    <div className={cn("font-heading text-3xl font-bold tracking-tight tabular-nums", ink)}>{count}</div>
                    <CardAction>
                      <span className={cn("flex size-9 items-center justify-center rounded-chip", tile)}>
                        <Icon aria-hidden="true" className="size-5" />
                      </span>
                    </CardAction>
                    <div className="col-span-2 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      {labels.length <= 1 ? (
                        <span>{labels[0]?.label ?? (kind === "booked" ? "201 Created" : kind === "taken" ? "409" : "5xx")}</span>
                      ) : (
                        labels.map((row) => <span key={row.label} className="tabular-nums">{`${row.label} ${row.count}`}</span>)
                      )}
                    </div>
                  </CardHeader>
                </Card>
              )
            })}
          </div>
          {/* The tiles above carry the numbers; the bar only shows the proportions at a glance. */}
          {run.outcomes.length > 0 && (
            <div aria-hidden="true" className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted">
              {outcomeOrder.map((kind) => {
                const count = byKind(kind).length
                return count > 0 ? <span key={kind} className={outcomeMeta[kind].bar} style={{ flexGrow: count, flexBasis: 0 }} /> : null
              })}
              {run.running && <span className="bg-muted" style={{ flexGrow: run.total - run.outcomes.length, flexBasis: 0 }} />}
            </div>
          )}
        </section>
      )}

      {timing && (
        <dl aria-label="Latency" className="grid grid-cols-3 gap-3">
          {(
            [
              ["p50", timing.p50],
              ["p95", timing.p95],
              ["Slowest", timing.max],
            ] as const
          ).map(([term, value]) => (
            <div key={term} className="rounded-chip bg-muted/60 px-3 py-2">
              <dt className="text-xs text-muted-foreground">{term}</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {value}
                <span className="ml-0.5 text-sm font-normal text-muted-foreground">ms</span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {run.traceId && (
        <p className="flex min-w-0 items-center gap-1.5 text-xs">
          <span className="shrink-0 text-muted-foreground">Run trace ID</span>
          <code className="truncate font-mono tracking-wide text-foreground/80" title={run.traceId}>
            {run.traceId}
          </code>
          <CopyButton value={run.traceId} label="Copy the run's trace ID" copiedLabel="Run trace ID copied" />
        </p>
      )}

      {ordered.length > 0 && (compact ? <ResultList outcomes={ordered} /> : <ResultTable outcomes={ordered} />)}
    </div>
  )
}

/** Which tile a tally row belongs to ("201 Created" to booked, "409 slot-unavailable" to taken, "5xx" to server, ...). */
function kindOfRow(label: string): OutcomeKind {
  if (label === "5xx") return "server"
  if (label === "No response") return "failed"
  return outcomeKind(Number.parseInt(label, 10))
}

/** A status code as a pill in its outcome's colours; the code is always written. */
function StatusPill({ status }: { status: number }) {
  const { tile } = outcomeMeta[outcomeKind(status)]
  return (
    <span className={cn("inline-flex h-6 items-center rounded-full px-2 text-xs font-semibold tabular-nums", tile)}>
      {status === 0 ? "None" : status}
    </span>
  )
}

function TraceCell({ traceId }: { traceId: string | null }) {
  if (!traceId) return <span className="text-muted-foreground">-</span>
  return (
    <span className="flex min-w-0 items-center gap-1">
      <code className="truncate font-mono text-xs tracking-wide text-foreground/80" title={traceId}>
        {traceId}
      </code>
      <CopyButton value={traceId} label="Copy trace ID" copiedLabel="Trace ID copied" />
    </span>
  )
}

function ResultTable({ outcomes }: { outcomes: StressOutcome[] }) {
  return (
    <div className="max-h-96 overflow-y-auto rounded-xl ring-1 ring-foreground/10">
      <Table aria-label="Results" className="table-fixed">
        <TableHeader className="sticky top-0 z-10">
          <TableRow>
            <TableHead className="w-12 text-right">#</TableHead>
            <TableHead className="w-20">Status</TableHead>
            <TableHead className="w-44">Problem</TableHead>
            <TableHead className="w-24 text-right">Duration</TableHead>
            <TableHead>Trace ID</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {outcomes.map((outcome) => (
            <TableRow key={outcome.index}>
              <TableCell className="text-right text-muted-foreground tabular-nums">{outcome.index + 1}</TableCell>
              <TableCell>
                <StatusPill status={outcome.status} />
              </TableCell>
              <TableCell className="truncate font-mono text-xs">{outcome.slug ?? (outcome.status === 201 ? "created" : "-")}</TableCell>
              <TableCell className="text-right tabular-nums">{`${Math.round(outcome.durationMs)} ms`}</TableCell>
              <TableCell className="max-w-0">
                <TraceCell traceId={outcome.traceId} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** Phones: each answer as a stacked row (pill, slug, duration, trace id with copy), never a sideways-scrolling table. */
function ResultList({ outcomes }: { outcomes: StressOutcome[] }) {
  return (
    <ul aria-label="Results" className="flex flex-col divide-y divide-border rounded-xl ring-1 ring-foreground/10">
      {outcomes.map((outcome) => (
        <li key={outcome.index} className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5">
          <span className="flex items-center gap-2">
            <span className="w-6 text-right text-xs text-muted-foreground tabular-nums">{outcome.index + 1}</span>
            <StatusPill status={outcome.status} />
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{outcome.slug ?? (outcome.status === 201 ? "created" : "-")}</span>
            <span className="shrink-0 text-xs tabular-nums">{`${Math.round(outcome.durationMs)} ms`}</span>
          </span>
          {outcome.traceId && (
            <span className="pl-8">
              <TraceCell traceId={outcome.traceId} />
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
