import { CalendarCheck, Clock, Gauge, Warehouse } from "lucide-react"

import { NO_FIGURE, ShareMeter, StatCard } from "@/components/stat-card"
import { countOf } from "@/lib/data-table"

import type { ResourceDay } from "../lib/data-provider"
import { bayFigures, type BayRecord, formatMinutes } from "../lib/resources"

interface BayFiguresProps {
  rows: readonly BayRecord[] | undefined
  /** The day the rows were read for: whether the dealership opens is its opening window's, never the rows'. */
  day: ResourceDay | undefined
  failed: boolean
}

/**
 * The bays in four figures (the users app's stat cards, UI_DESIGN 11.11): the bays, those in use today, the time booked in
 * them and the bay utilisation, the same figure the dispatch board's KPI strip shows for today (lib/booked-time). A closed
 * day says so; an open day with no bay in service has no bay time to measure against.
 */
export function BayFigures({ rows, day, failed }: BayFiguresProps) {
  const figures = rows && day ? bayFigures(rows, day) : undefined
  const closed = figures?.capacityMinutes === null
  const unavailable = !figures && failed
  const value = (text: string | undefined) => (unavailable ? NO_FIGURE : text)
  const footer = (text: string | undefined) => (unavailable ? "Unavailable" : text)
  const noneInService = "No bays in service"

  return (
    <section aria-label="Bays summary" className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
      <StatCard
        label="Bays"
        icon={Warehouse}
        value={value(figures && String(figures.total))}
        footer={footer(
          figures &&
            (figures.total === 0
              ? "None set up yet"
              : figures.inService === figures.total
                ? "All in service"
                : `${figures.inService} in service, ${figures.total - figures.inService} out of service`)
        )}
        detail="At the dealership"
      />
      <StatCard
        label="In use today"
        icon={CalendarCheck}
        value={value(figures && (closed ? NO_FIGURE : `${figures.inUse} of ${figures.inService}`))}
        footer={footer(figures && (closed ? "Closed today" : figures.inService === 0 ? noneInService : "With at least one appointment"))}
        detail="Bays in service"
      />
      <StatCard
        label="Booked today"
        icon={Clock}
        value={value(figures && (closed ? NO_FIGURE : formatMinutes(figures.bookedMinutes)))}
        footer={footer(figures && (closed ? "Closed today" : `Across ${countOf(figures.appointments, { one: "appointment", other: "appointments" })}`))}
        detail="Bays in service, in opening hours"
      />
      <StatCard
        label="Bay utilisation"
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
                ? noneInService
                : `${formatMinutes(figures.bookedMinutes)} booked of ${formatMinutes(figures.capacityMinutes)}`)
        )}
        detail="Booked time over open bay time"
      />
    </section>
  )
}
