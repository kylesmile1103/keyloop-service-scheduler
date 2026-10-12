// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/users/components/stat-cards.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { CalendarCheck, Clock, Gauge, UsersRound } from "lucide-react"

import { NO_FIGURE, ShareMeter, StatCard } from "@/components/stat-card"
import { countOf } from "@/lib/data-table"

import type { ResourceDay } from "../lib/data-provider"
import { formatMinutes, technicianFigures, type TechnicianRecord } from "../lib/resources"

interface TechnicianFiguresProps {
  rows: readonly TechnicianRecord[] | undefined
  /** The day the rows were read for: whether the dealership opens is its opening window's, never the rows'. */
  day: ResourceDay | undefined
  failed: boolean
}

/**
 * The roster in four figures (the users app's stat cards, UI_DESIGN 11.11): the technicians, those working today, the time
 * booked today and the technicians' load, measured as the board measures bay utilisation (booked time over open time, a
 * no-show none). A closed day says so; an open day with no active technician has nothing to measure the load against.
 * No trend badges: the API keeps no history to compare with.
 */
export function TechnicianFigures({ rows, day, failed }: TechnicianFiguresProps) {
  const figures = rows && day ? technicianFigures(rows, day) : undefined
  const closed = figures?.capacityMinutes === null
  const unavailable = !figures && failed
  const value = (text: string | undefined) => (unavailable ? NO_FIGURE : text)
  const footer = (text: string | undefined) => (unavailable ? "Unavailable" : text)
  const noneActive = "No active technicians"

  return (
    <section aria-label="Roster summary" className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
      <StatCard
        label="Technicians"
        icon={UsersRound}
        value={value(figures && String(figures.total))}
        footer={footer(
          figures &&
            (figures.total === 0
              ? "None yet"
              : figures.active === figures.total
                ? "All active"
                : `${figures.active} active, ${figures.total - figures.active} inactive`)
        )}
        detail="On the dealership's roster"
      />
      <StatCard
        label="Working today"
        icon={CalendarCheck}
        value={value(figures && (closed ? NO_FIGURE : `${figures.working} of ${figures.active}`))}
        footer={footer(figures && (closed ? "Closed today" : figures.active === 0 ? noneActive : "With at least one appointment"))}
        detail="Active technicians"
      />
      <StatCard
        label="Booked today"
        icon={Clock}
        value={value(figures && (closed ? NO_FIGURE : formatMinutes(figures.bookedMinutes)))}
        footer={footer(figures && (closed ? "Closed today" : `Across ${countOf(figures.appointments, { one: "appointment", other: "appointments" })}`))}
        detail="Active technicians, in opening hours"
      />
      <StatCard
        label="Technician load"
        icon={Gauge}
        value={value(
          figures && (figures.capacityMinutes ? `${Math.round((figures.bookedMinutes / figures.capacityMinutes) * 100)}%` : NO_FIGURE)
        )}
        meter={figures?.capacityMinutes ? <ShareMeter share={figures.bookedMinutes / figures.capacityMinutes} /> : undefined}
        footer={footer(
          figures &&
            (figures.capacityMinutes === null
              ? "Closed today"
              : figures.capacityMinutes === 0
                ? noneActive
                : `${formatMinutes(figures.bookedMinutes)} booked of ${formatMinutes(figures.capacityMinutes)}`)
        )}
        detail="Booked over open technician time"
      />
    </section>
  )
}
