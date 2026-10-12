import { CalendarClock, CircleCheck, ClipboardList, type LucideIcon, UserX } from "lucide-react"
import { type ReactNode, useId } from "react"

import type { AppointmentStatus } from "@/api/types.gen"
import { boardStatuses, statusMeta } from "@/app/dispatch/lib/status"
import { Card, CardAction, CardDescription, CardFooter, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

import { type AppointmentRow, appointmentStats } from "../lib/appointments"

/** What a card shows when it has no figure (the day failed to load); read out in words. */
const NO_FIGURE = "–"

interface StatCardsProps {
  /** The day's appointments; `undefined` while the day loads. */
  rows: readonly AppointmentRow[] | undefined
  failed: boolean
  /** "Today" or "Tuesday 13 October". */
  dayWords: string
}

/**
 * The day in four figures, adopted from the template's users `stat-cards.tsx`: the appointments on the list, the active
 * ones, the completed ones and the no-shows. As on the board's KPI strip (DESIGN_SYSTEM 11.11, 11.19) there are no trend
 * badges, because the API keeps no history to compare with; the completed and no-show cards carry their status's icon
 * tile, and the total a thin bar of the day by status, in the status markers the list's badges use.
 */
export function StatCards({ rows, failed, dayWords }: StatCardsProps) {
  const stats = rows ? appointmentStats(rows) : undefined
  const value = (count: number | undefined) => (count === undefined ? (failed ? NO_FIGURE : undefined) : String(count))

  return (
    <section aria-label="Day summary" className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
      <StatCard
        label="Appointments"
        icon={ClipboardList}
        value={value(stats?.total)}
        footer={rows ? (rows.length > 0 ? statusSummary(rows) : "Nothing booked") : undefined}
        detail={dayWords}
        meter={rows && rows.length > 0 ? <StatusMeter rows={rows} /> : undefined}
      />
      <StatCard
        label="Active"
        icon={CalendarClock}
        value={value(stats?.active)}
        footer={stats ? share(stats.active, stats.total) : undefined}
        detail="Confirmed, checked in or in progress"
      />
      <StatCard
        label="Completed"
        icon={CircleCheck}
        tile={statusMeta.Completed.classes.tile}
        value={value(stats?.completed)}
        footer={stats ? share(stats.completed, stats.total) : undefined}
        detail="Work finished"
      />
      <StatCard
        label="No-shows"
        icon={UserX}
        tile={statusMeta.NoShow.classes.tile}
        value={value(stats?.noShows)}
        footer={stats ? share(stats.noShows, stats.total) : undefined}
        detail="Customers who did not arrive"
      />
    </section>
  )
}

interface StatCardProps {
  label: string
  icon: LucideIcon
  /** The icon tile's colours: a status's tint and ink, or the neutral tile. */
  tile?: string
  /** `undefined` while loading. */
  value: string | undefined
  footer: ReactNode
  detail: ReactNode
  meter?: ReactNode
}

function StatCard({ label, icon: Icon, tile = "rounded-chip bg-secondary text-secondary-foreground", value, footer, detail, meter }: StatCardProps) {
  const labelId = useId()
  const loading = value === undefined

  return (
    <Card size="sm" role="group" aria-labelledby={labelId} aria-busy={loading || undefined} className="shadow-xs">
      <CardHeader>
        <CardDescription id={labelId}>{label}</CardDescription>
        <div className="font-heading text-2xl font-bold tracking-tight tabular-nums md:text-3xl">
          {loading ? (
            <Skeleton className="my-1 h-7 w-12" />
          ) : value === NO_FIGURE ? (
            <>
              <span aria-hidden="true">{NO_FIGURE}</span>
              <span className="sr-only">No figure</span>
            </>
          ) : (
            value
          )}
        </div>
        <CardAction>
          <span aria-hidden="true" className={cn("flex size-9 items-center justify-center max-md:size-8", tile)}>
            <Icon className="size-5 max-md:size-4" />
          </span>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 border-t-0 bg-transparent pt-0">
        {meter}
        {loading ? (
          <Skeleton className="h-4 w-3/4" />
        ) : (
          <div className="line-clamp-2 text-xs text-pretty text-muted-foreground">{value === NO_FIGURE ? "Unavailable" : footer}</div>
        )}
        <div className="line-clamp-1 text-xs text-muted-foreground max-md:hidden">{detail}</div>
      </CardFooter>
    </Card>
  )
}

/**
 * The day by status as one thin bar of the status markers, in lifecycle order (DESIGN_SYSTEM 13: a chart of appointments by
 * status uses the status markers). Decorative: the footer writes the same figures out.
 */
function StatusMeter({ rows }: { rows: readonly AppointmentRow[] }) {
  const counts = countByStatus(rows)
  return (
    <span aria-hidden="true" className="mb-1 flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full">
      {boardStatuses
        .filter((status) => counts.has(status))
        .map((status) => (
          <span key={status} className={cn("h-full rounded-full", statusMeta[status].classes.dot)} style={{ flexGrow: counts.get(status) }} />
        ))}
    </span>
  )
}

function countByStatus(rows: readonly AppointmentRow[]): Map<AppointmentStatus, number> {
  const counts = new Map<AppointmentStatus, number>()
  for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1)
  return counts
}

/** "4 confirmed, 1 in progress, 1 completed": the day by status, in lifecycle order. */
function statusSummary(rows: readonly AppointmentRow[]): string {
  const counts = countByStatus(rows)
  return boardStatuses
    .filter((status) => counts.has(status))
    .map((status) => `${counts.get(status)} ${statusMeta[status].label.toLowerCase()}`)
    .join(", ")
}

/** "2 of 6 appointments", "None of 6 appointments", or "Nothing booked" on an empty day. */
function share(count: number, total: number): string {
  if (total === 0) return "Nothing booked"
  const of = `of ${total} ${total === 1 ? "appointment" : "appointments"}`
  return count === 0 ? `None ${of}` : `${count} ${of}`
}
