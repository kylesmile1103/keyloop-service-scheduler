import { CalendarCheck, Clock, Gauge, UsersRound } from "lucide-react"

import { NO_FIGURE, ShareMeter, StatCard } from "@/components/stat-card"
import { countOf } from "@/lib/data-table"

import { formatMinutes, technicianFigures, type TechnicianRecord } from "../lib/resources"

/**
 * The roster in four figures (the users app's stat cards, UI_DESIGN 11.11): the technicians, those working today, the time
 * booked today and the technicians' load, measured as the board measures bay utilisation (booked time over open time, a
 * no-show none). No trend badges: the API keeps no history to compare with.
 */
export function TechnicianFigures({ rows, failed }: { rows: readonly TechnicianRecord[] | undefined; failed: boolean }) {
  const figures = rows ? technicianFigures(rows) : undefined
  const closed = figures?.capacityMinutes === null
  const unavailable = !figures && failed
  const value = (text: string | undefined) => (unavailable ? NO_FIGURE : text)
  const footer = (text: string | undefined) => (unavailable ? "Unavailable" : text)

  return (
    <section aria-label="Roster summary" className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
      <StatCard
        label="Technicians"
        icon={UsersRound}
        value={value(figures && String(figures.total))}
        footer={footer(
          figures && (figures.active === figures.total ? "All active" : `${figures.active} active, ${figures.total - figures.active} inactive`)
        )}
        detail="On the dealership's roster"
      />
      <StatCard
        label="Working today"
        icon={CalendarCheck}
        value={value(figures && (closed ? NO_FIGURE : `${figures.working} of ${figures.active}`))}
        footer={footer(figures && (closed ? "Closed today" : "With at least one appointment"))}
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
              : `${formatMinutes(figures.bookedMinutes)} booked of ${formatMinutes(figures.capacityMinutes)}`)
        )}
        detail="Booked over open technician time"
      />
    </section>
  )
}
