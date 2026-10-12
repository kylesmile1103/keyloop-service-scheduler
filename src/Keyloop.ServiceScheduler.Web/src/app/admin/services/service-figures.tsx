import { CalendarCheck, CircleCheck, ListChecks, Timer } from "lucide-react"

import { NO_FIGURE, StatCard } from "@/components/stat-card"
import { countOf } from "@/lib/data-table"

import { serviceFigures, type ServiceRecord } from "../lib/resources"

interface ServiceFiguresProps {
  rows: readonly ServiceRecord[] | undefined
  failed: boolean
  /** The dealership is closed today. */
  closed: boolean
}

/**
 * The catalogue in four figures (the users app's stat cards, UI_DESIGN 11.11): the services, those this dealership can
 * book, today's bookings and the range of durations.
 */
export function ServiceFigures({ rows, failed, closed }: ServiceFiguresProps) {
  const figures = rows ? serviceFigures(rows) : undefined
  const unavailable = !figures && failed
  const value = (text: string | undefined) => (unavailable ? NO_FIGURE : text)
  const footer = (text: string | undefined) => (unavailable ? "Unavailable" : text)

  return (
    <section aria-label="Catalogue summary" className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
      <StatCard
        label="Services"
        icon={ListChecks}
        value={value(figures && String(figures.total))}
        footer={footer(figures && "In the catalogue")}
        detail="Shared by every dealership"
      />
      <StatCard
        label="Bookable here"
        icon={CircleCheck}
        value={value(figures && `${figures.bookable} of ${figures.total}`)}
        footer={footer(
          figures &&
            (figures.bookable === figures.total ? "Every service can be booked" : `${figures.total - figures.bookable} need what this dealership lacks`)
        )}
        detail="An active bay and technician qualify"
      />
      <StatCard
        label="Booked today"
        icon={CalendarCheck}
        value={value(figures && (closed ? NO_FIGURE : String(figures.bookedToday)))}
        footer={footer(
          figures &&
            (closed
              ? "Closed today"
              : figures.bookedToday === 0
                ? "Nothing booked"
                : `Across ${countOf(figures.servicesBookedToday, { one: "service", other: "services" })}`)
        )}
        detail="On today's schedule"
      />
      <StatCard
        label="Durations"
        icon={Timer}
        value={value(
          figures && (figures.shortestMinutes === null ? NO_FIGURE : `${figures.shortestMinutes}–${figures.longestMinutes} min`)
        )}
        footer={footer(figures && "From the shortest job to the longest")}
        detail="Time a bay and a technician are held"
      />
    </section>
  )
}
