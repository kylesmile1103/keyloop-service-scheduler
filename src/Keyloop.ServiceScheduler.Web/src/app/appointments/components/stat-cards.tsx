// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/users/components/stat-cards.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { CalendarClock, CircleCheck, ClipboardList, UserX } from "lucide-react"

import type { AppointmentStatus } from "@/api/types.gen"
import { boardStatuses, statusMeta } from "@/app/dispatch/lib/status"
import { NO_FIGURE, StatCard } from "@/components/stat-card"
import { cn } from "@/lib/utils"

import { type AppointmentRow, appointmentStats } from "../lib/appointments"

interface StatCardsProps {
  rows: readonly AppointmentRow[] | undefined
  failed: boolean
  dayWords: string
}

/** Daily summary stat cards for the appointments list. */
export function StatCards({ rows, failed, dayWords }: StatCardsProps) {
  const stats = rows ? appointmentStats(rows) : undefined
  const value = (count: number | undefined) => (count === undefined ? (failed ? NO_FIGURE : undefined) : String(count))
  const footer = (text: string | undefined) => (stats ? text : failed ? "Unavailable" : undefined)

  return (
    <section aria-label="Day summary" className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
      <StatCard
        label="Appointments"
        icon={ClipboardList}
        value={value(stats?.total)}
        footer={footer(rows && (rows.length > 0 ? statusSummary(rows) : "Nothing booked"))}
        detail={dayWords}
        meter={rows && rows.length > 0 ? <StatusMeter rows={rows} /> : undefined}
      />
      <StatCard
        label="Active"
        icon={CalendarClock}
        value={value(stats?.active)}
        footer={footer(stats && share(stats.active, stats.total))}
        detail="Confirmed, checked in or in progress"
      />
      <StatCard
        label="Completed"
        icon={CircleCheck}
        tile={statusMeta.Completed.classes.tile}
        value={value(stats?.completed)}
        footer={footer(stats && share(stats.completed, stats.total))}
        detail="Work finished"
      />
      <StatCard
        label="No-shows"
        icon={UserX}
        tile={statusMeta.NoShow.classes.tile}
        value={value(stats?.noShows)}
        footer={footer(stats && share(stats.noShows, stats.total))}
        detail="Customers who did not arrive"
      />
    </section>
  )
}

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

function statusSummary(rows: readonly AppointmentRow[]): string {
  const counts = countByStatus(rows)
  return boardStatuses
    .filter((status) => counts.has(status))
    .map((status) => `${counts.get(status)} ${statusMeta[status].label.toLowerCase()}`)
    .join(", ")
}

function share(count: number, total: number): string {
  if (total === 0) return "Nothing booked"
  const of = `of ${total} ${total === 1 ? "appointment" : "appointments"}`
  return count === 0 ? `None ${of}` : `${count} ${of}`
}
