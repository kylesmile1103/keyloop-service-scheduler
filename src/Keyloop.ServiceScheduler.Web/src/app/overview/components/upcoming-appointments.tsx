// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/dashboard-2/components/recent-transactions.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { ChevronRight } from "lucide-react"
import { useId } from "react"
import { Link, type To } from "react-router-dom"

import type { AppointmentListItemResponse } from "@/api/types.gen"
import { PlateChip } from "@/app/dispatch/components/appointment-block"
import { StatusBadge } from "@/app/dispatch/components/status-badge"
import { jobCardLabel, timeRange } from "@/app/dispatch/lib/appointment-text"
import { statusMeta } from "@/app/dispatch/lib/status"
import { Card, CardAction, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { localDateOf } from "@/lib/appointment-range"
import { formatDay, shiftDate } from "@/lib/calendar-date"
import { cn } from "@/lib/utils"

interface UpcomingAppointmentsProps {
  appointments: readonly AppointmentListItemResponse[] | undefined
  today: string
  timeZone: string
  calendar: To
  selectedId: string | null
  onSelect: (appointment: AppointmentListItemResponse, row: HTMLElement) => void
}

function dayWord(date: string, today: string): string {
  if (date === today) return "Today"
  if (date === shiftDate(today, 1)) return "Tomorrow"
  return formatDay(date, "short")
}

/** List of upcoming confirmed, checked-in, and in-progress appointments. */
export function UpcomingAppointments({ appointments, today, timeZone, calendar, selectedId, onSelect }: UpcomingAppointmentsProps) {
  const headingId = useId()

  return (
    <Card className="min-w-0 gap-0 pb-0 shadow-xs" role="region" aria-labelledby={headingId}>
      <CardHeader className="border-b">
        <h2 id={headingId} className="font-heading text-lg leading-snug font-semibold">
          Upcoming appointments
        </h2>
        <CardDescription>Confirmed, checked-in and in-progress work that has not finished, soonest first.</CardDescription>
        <CardAction>
          <Link
            to={calendar}
            className="group/link inline-flex min-h-10 items-center gap-1 rounded-sm text-sm font-semibold text-signal underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
          >
            Open calendar
            <ChevronRight aria-hidden="true" className="size-4 transition-transform duration-150 group-hover/link:translate-x-0.5" />
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        {!appointments ? (
          <div aria-busy="true" className="flex flex-col divide-y">
            {[0, 1, 2].map((index) => (
              <div key={index} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="h-9 w-24" />
                <Skeleton className="h-9 flex-1" />
              </div>
            ))}
          </div>
        ) : appointments.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Nothing else is booked in the next 14 days.</p>
        ) : (
          <ol aria-labelledby={headingId} className="flex flex-col divide-y">
            {appointments.map((appointment) => {
              const day = dayWord(localDateOf(appointment), today)
              const selected = appointment.id === selectedId
              return (
                <li key={appointment.id}>
                  <button
                    type="button"
                    aria-label={`${day}, ${jobCardLabel(appointment, timeZone)}`}
                    aria-haspopup="dialog"
                    aria-expanded={selected}
                    data-appointment-id={appointment.id}
                    data-selected={selected || undefined}
                    onClick={(event) => onSelect(appointment, event.currentTarget)}
                    className={cn(
                      "grid min-h-11 w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-l-3 px-4 py-3 text-left outline-none hover:bg-muted/50",
                      "md:grid-cols-[7.5rem_minmax(0,1.3fr)_minmax(0,1fr)_auto] lg:grid-cols-[8rem_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]",
                      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-selected:bg-muted/50",
                      statusMeta[appointment.status].classes.bar
                    )}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="text-xs text-muted-foreground">{day}</span>
                      <span className="text-dense font-semibold tabular-nums">{timeRange(appointment, timeZone)}</span>
                    </span>
                    <StatusBadge status={appointment.status} className="justify-self-end md:order-last" />
                    <span className="col-span-2 flex min-w-0 flex-col md:col-span-1">
                      <span className="truncate text-sm font-semibold">{appointment.serviceType.name}</span>
                      <span className="truncate text-dense text-muted-foreground lg:hidden">{`${appointment.bay.name} · ${appointment.technician.name}`}</span>
                    </span>
                    <span className="col-span-2 flex min-w-0 items-center gap-2 md:col-span-1">
                      <span className="min-w-0 truncate text-dense">{appointment.customerName}</span>
                      <PlateChip registration={appointment.registration} />
                    </span>
                    <span className="hidden min-w-0 flex-col text-dense lg:flex">
                      <span className="truncate">{appointment.bay.name}</span>
                      <span className="truncate text-muted-foreground">{appointment.technician.name}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
