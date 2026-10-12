// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/dashboard/components/chart-area-interactive.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { useId, useState } from "react"
import { Link } from "react-router-dom"

import { Card, CardAction, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDay } from "@/lib/calendar-date"
import { cn } from "@/lib/utils"
import { DATE_PARAM, DEALERSHIP_PARAM } from "@/lib/workshop-params"

import { type BookingsSummary, chartSummary, type DayCount, lineRuns, OVERVIEW_DAYS_AROUND } from "../lib/overview"

interface BookingsChartProps {
  dealershipId: string
  today: string
  /** One entry per day of the window; `undefined` while the range read loads. */
  days: readonly DayCount[] | undefined
  summary: BookingsSummary | undefined
}

/** The chart's ceiling: the busiest day rounded up to an even number, never below 4, so a quiet fortnight is not drawn as a peak. */
function ceiling(peak: number): number {
  return Math.max(4, Math.ceil(peak / 2) * 2)
}

/** "29 Sep" from "Tue 29 Sep". */
const dayMonth = (date: string) => formatDay(date, "short").slice(4)
/** "Tuesday 13 October" from "Tuesday 13 October 2026". */
const longDay = (date: string) => formatDay(date, "long").replace(/ \d{4}$/, "")
const bookings = (count: number) => `${count} ${count === 1 ? "booking" : "bookings"}`

/**
 * Bookings per day, the fortnight either side of today (adopted from the template's `chart-area-interactive`, drawn without
 * a chart library: UI_DESIGN 13 and 11.19). One series in `chart-1`: a flat fill under a line, solid for the days that have
 * happened and dashed ahead of today, where bookings are still coming in. Today is marked as the board marks now (the
 * destructive line and pill); the dealership's closed days are hatched as on the board. The written summary under the
 * chart and the Table view say the same in words and numbers, each day linking to its board.
 */
export function BookingsChart({ dealershipId, today, days, summary }: BookingsChartProps) {
  const headingId = useId()
  const summaryId = useId()
  const [view, setView] = useState<"chart" | "table">("chart")

  return (
    <Card className="min-w-0 shadow-xs" role="region" aria-labelledby={headingId}>
      <Tabs value={view} onValueChange={(value: "chart" | "table") => setView(value)} className="gap-4">
        <CardHeader>
          <h2 id={headingId} className="font-heading text-lg leading-snug font-semibold">
            Bookings per day
          </h2>
          <CardDescription>{`The ${OVERVIEW_DAYS_AROUND} days before today and the ${OVERVIEW_DAYS_AROUND} after, cancellations left out.`}</CardDescription>
          <CardAction>
            <TabsList aria-label="Show bookings per day as" className="pointer-coarse:min-h-12.5">
              <TabsTrigger value="chart" className="cursor-pointer px-3 pointer-coarse:min-h-11">
                Chart
              </TabsTrigger>
              <TabsTrigger value="table" className="cursor-pointer px-3 pointer-coarse:min-h-11">
                Table
              </TabsTrigger>
            </TabsList>
          </CardAction>
        </CardHeader>
        <CardContent>
          {!days || !summary ? (
            <div aria-busy="true">
              <p role="status" className="sr-only">
                Loading bookings per day…
              </p>
              <Skeleton className="h-52 w-full md:h-60" />
            </div>
          ) : (
            <>
              <TabsContent value="chart" tabIndex={-1}>
                <Plot days={days} summary={summary} today={today} describedBy={summaryId} />
              </TabsContent>
              <TabsContent value="table" tabIndex={-1}>
                <DayTable days={days} dealershipId={dealershipId} today={today} />
              </TabsContent>
              <p id={summaryId} className="mt-3 text-sm text-pretty text-muted-foreground tabular-nums">
                {chartSummary(summary)}
              </p>
            </>
          )}
        </CardContent>
      </Tabs>
    </Card>
  )
}

/** Where the five date labels go: the window's ends, a week either side of today, and today. */
const LABEL_STEPS = [-OVERVIEW_DAYS_AROUND, -7, 0, 7, OVERVIEW_DAYS_AROUND]

function Plot({ days, summary, today, describedBy }: { days: readonly DayCount[]; summary: BookingsSummary; today: string; describedBy: string }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const count = days.length
  const top = ceiling(summary.peak)
  const x = (index: number) => ((index + 0.5) / count) * 100
  const y = (value: number) => 100 - (value / top) * 100
  const todayIndex = Math.max(0, days.findIndex((day) => day.when === "today"))
  const runs = lineRuns(days)
  const line = (indices: readonly number[]) => indices.map((index, at) => `${at === 0 ? "M" : "L"}${x(index)},${y(days[index].count)}`).join(" ")
  const area = (run: readonly number[]) => `M${x(run[0])},100 ${run.map((index) => `L${x(index)},${y(days[index].count)}`).join(" ")} L${x(run[run.length - 1])},100 Z`
  // A day with no neighbour to join draws as a dot (a path of one point draws nothing).
  const lonely = runs.filter((run) => run.length === 1).map((run) => run[0])
  const point = hovered !== null ? days[hovered] : null
  const first = days[0].date
  const last = days[count - 1].date

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
      {/* The scale: the ceiling, half of it and zero, level with their gridlines. */}
      <div aria-hidden="true" className="relative h-52 w-6 text-right text-xs text-muted-foreground tabular-nums md:h-60">
        {[top, top / 2, 0].map((value) => (
          <span key={value} className="absolute right-0 -translate-y-1/2" style={{ top: `${y(value)}%` }}>
            {value}
          </span>
        ))}
      </div>
      <div
        role="img"
        aria-label={`Bookings per day from ${longDay(first)} to ${formatDay(last, "long")}`}
        aria-describedby={describedBy}
        className="relative h-52 md:h-60"
        onPointerLeave={() => setHovered(null)}
      >
        {/* Closed days, hatched as the board hatches closed time. */}
        <div aria-hidden="true" className="absolute inset-0 flex">
          {days.map((day) => (
            <div key={day.date} className={cn("h-full flex-1", day.closed && "bg-hatch")} />
          ))}
        </div>
        {[top, top / 2, 0].map((value) => (
          <div key={value} aria-hidden="true" className="absolute inset-x-0 border-t border-border" style={{ top: `${y(value)}%` }} />
        ))}
        <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
          {runs.map((run) => (
            <g key={run[0]}>
              <path d={area(run)} className="fill-chart-1/12 stroke-none" />
              <path
                d={line(run.filter((index) => index <= todayIndex))}
                vectorEffect="non-scaling-stroke"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                className="fill-none stroke-chart-1"
              />
              <path
                d={line(run.filter((index) => index >= todayIndex))}
                vectorEffect="non-scaling-stroke"
                strokeWidth={2}
                strokeDasharray="5 4"
                strokeLinejoin="round"
                className="fill-none stroke-chart-1"
              />
            </g>
          ))}
        </svg>
        {lonely.map((index) => (
          <span
            key={index}
            aria-hidden="true"
            className="pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-chart-1"
            style={{ left: `${x(index)}%`, top: `${y(days[index].count)}%` }}
          />
        ))}
        {/* Today, marked as the board marks now. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-destructive" style={{ left: `${x(todayIndex)}%` }}>
          <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-destructive px-1.5 text-2xs font-semibold text-destructive-foreground">
            Today
          </span>
        </div>
        {point && hovered !== null && (
          <>
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-foreground/30" style={{ left: `${x(hovered)}%` }} />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-chart-1 ring-2 ring-card"
              style={{ left: `${x(hovered)}%`, top: `${y(point.count)}%` }}
            />
            <div
              aria-hidden="true"
              data-slot="chart-readout"
              className={cn(
                "pointer-events-none absolute top-3 z-10 rounded-lg bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap text-popover-foreground shadow-md ring-1 ring-foreground/10",
                hovered < 4 ? "translate-x-2" : hovered > count - 5 ? "-translate-x-[calc(100%+0.5rem)]" : "-translate-x-1/2"
              )}
              style={{ left: `${x(hovered)}%` }}
            >
              <span className="block font-semibold">{point.date === today ? `Today, ${dayMonth(point.date)}` : formatDay(point.date, "short")}</span>
              <span className="text-muted-foreground tabular-nums">{point.closed && point.count === 0 ? "Closed" : bookings(point.count)}</span>
            </div>
          </>
        )}
        {/* Pointer targets, one per day. */}
        <div aria-hidden="true" className="absolute inset-0 flex">
          {days.map((day, index) => (
            <div key={day.date} className="h-full flex-1" onPointerEnter={() => setHovered(index)} />
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="relative col-start-2 mt-2 h-4 text-xs text-muted-foreground tabular-nums">
        {LABEL_STEPS.map((step) => {
          const index = todayIndex + step
          if (index < 0 || index >= count) return null
          return (
            <span
              key={step}
              className={cn(
                "absolute whitespace-nowrap",
                index === 0 ? "translate-x-0" : index === count - 1 ? "-translate-x-full" : "-translate-x-1/2",
                step === 0 && "font-semibold text-foreground"
              )}
              style={{ left: index === 0 ? 0 : index === count - 1 ? "100%" : `${x(index)}%` }}
            >
              {step === 0 ? "Today" : dayMonth(days[index].date)}
            </span>
          )
        })}
      </div>
      <ChartLegend />
    </div>
  )
}

/** The key to the chart's marks (UI_DESIGN 13: two or more series have a legend), in words beside each mark. */
function ChartLegend() {
  const mark = "h-0 w-5 shrink-0 border-t-2 border-chart-1"
  return (
    <ul aria-hidden="true" className="col-start-2 mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <span className={mark} />
        Before today
      </li>
      <li className="flex items-center gap-1.5">
        <span className={cn(mark, "border-dashed")} />
        From today, still filling
      </li>
      <li className="flex items-center gap-1.5">
        <span className="h-3 w-0.5 shrink-0 bg-destructive" />
        Today
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-3 shrink-0 rounded-sm bg-hatch ring-1 ring-border" />
        Closed
      </li>
    </ul>
  )
}

/** The chart's numbers: one row per day, each day linking to its dispatch board. */
function DayTable({ days, dealershipId, today }: { days: readonly DayCount[]; dealershipId: string; today: string }) {
  const boardOf = (date: string) => {
    const search = new URLSearchParams({ [DEALERSHIP_PARAM]: dealershipId })
    if (date !== today) search.set(DATE_PARAM, date)
    return { pathname: "/dispatch", search: `?${search}` }
  }
  return (
    <div className="max-h-60 overflow-y-auto rounded-lg ring-1 ring-foreground/10">
      <Table>
        <TableCaption className="sr-only">Bookings per day, cancellations left out</TableCaption>
        <TableHeader className="sticky top-0 bg-card">
          <TableRow>
            <TableHead>Day</TableHead>
            <TableHead className="text-right">Bookings</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {days.map((day) => (
            <TableRow key={day.date} data-today={day.when === "today" || undefined} className="data-today:bg-muted/50">
              <TableCell>
                <Link
                  to={boardOf(day.date)}
                  className="rounded-sm text-signal underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {formatDay(day.date, "short")}
                </Link>
                {day.when === "today" && <span className="ml-2 text-xs font-semibold">Today</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{day.closed && day.count === 0 ? <span className="text-muted-foreground">Closed</span> : day.count}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
