// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/calendar/components/calendar-main.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { useId } from "react"

import type { AppointmentListItemResponse } from "@/api/types.gen"
import { PlateChip } from "@/app/dispatch/components/appointment-block"
import { StatusBadge } from "@/app/dispatch/components/status-badge"
import { jobCardLabel, timeRange } from "@/app/dispatch/lib/appointment-text"
import { statusMeta } from "@/app/dispatch/lib/status"
import { InitialsAvatar } from "@/components/initials-avatar"
import { formatDay } from "@/lib/calendar-date"
import { cn } from "@/lib/utils"

import { bookableDay, isOpen } from "../lib/calendar"
import { DayLink, NewOnDay } from "./day-parts"
import type { DaysProps } from "./week-view"

/** Mobile agenda list grouping calendar appointments by day. */
export function CalendarAgenda({ days, ...rest }: DaysProps) {
  return (
    <ol className="flex flex-col gap-3">
      {days.map((date) => (
        <AgendaDay key={date} date={date} {...rest} />
      ))}
    </ol>
  )
}

function AgendaDay({ date, byDay, dealership, today, selectedId, onSelect, onNew, bookState }: Omit<DaysProps, "days"> & { date: string }) {
  const headingId = useId()
  const items = byDay.get(date) ?? []
  const open = isOpen(dealership, date)
  const timeZone = dealership.timeZoneId

  return (
    <li>
      <section aria-labelledby={headingId}>
        <div className="sticky top-0 z-10 -mx-1 flex min-h-11 items-center gap-2 bg-background/95 px-1 backdrop-blur">
          <h3 id={headingId} className="min-w-0 flex-1 truncate text-sm font-semibold">
            <DayLink date={date} today={today} dealershipId={dealership.id}>
              {formatDay(date, "long").replace(/ \d{4}$/, "")}
              {date === today && <span className="rounded-full bg-primary px-2 text-2xs leading-5 font-semibold text-primary-foreground">Today</span>}
            </DayLink>
          </h3>
          {items.length > 0 && (
            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
              {items.length}
              <span className="sr-only">{items.length === 1 ? " appointment" : " appointments"}</span>
            </span>
          )}
          {bookableDay(dealership, date, today) && <NewOnDay date={date} onNew={onNew} bookState={bookState} />}
        </div>
        {items.length > 0 ? (
          <ol className="flex flex-col gap-2 pt-1">
            {items.map((appointment) => (
              <li key={appointment.id}>
                <AgendaCard appointment={appointment} timeZone={timeZone} selected={appointment.id === selectedId} onSelect={onSelect} />
              </li>
            ))}
          </ol>
        ) : (
          <p className={cn("rounded-chip border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground", !open && "border-solid bg-hatch")}>
            {!open ? "Closed" : date < today ? "Nothing was booked" : "Nothing booked"}
          </p>
        )}
      </section>
    </li>
  )
}

interface AgendaCardProps {
  appointment: AppointmentListItemResponse
  timeZone: string
  selected: boolean
  onSelect: (appointment: AppointmentListItemResponse, card: HTMLElement) => void
}

function AgendaCard({ appointment, timeZone, selected, onSelect }: AgendaCardProps) {
  return (
    <button
      type="button"
      aria-label={jobCardLabel(appointment, timeZone)}
      aria-haspopup="dialog"
      aria-expanded={selected}
      data-appointment-id={appointment.id}
      data-selected={selected || undefined}
      onClick={(event) => onSelect(appointment, event.currentTarget)}
      className={cn(
        "flex min-h-11 w-full cursor-pointer flex-col gap-1.5 rounded-chip border-l-3 bg-card p-3 text-left shadow-xs ring-1 ring-foreground/10 outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-selected:ring-2 data-selected:ring-primary",
        statusMeta[appointment.status].classes.bar
      )}
    >
      <span className="flex min-w-0 items-center justify-between gap-2">
        <span className="text-dense font-semibold tabular-nums">
          {timeRange(appointment, timeZone)}
          <span className="font-normal text-muted-foreground">{` · ${appointment.serviceType.durationMinutes} min`}</span>
        </span>
        <InitialsAvatar name={appointment.technician.name} />
      </span>
      <span className="truncate text-sm font-semibold">{appointment.customerName}</span>
      <span className="flex min-w-0 items-center gap-2">
        <PlateChip registration={appointment.registration} />
        <span className="min-w-0 truncate font-mono text-xs tracking-wide text-muted-foreground">{appointment.vin}</span>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <StatusBadge status={appointment.status} />
        <span className="min-w-0 truncate text-dense font-medium">{appointment.serviceType.name}</span>
      </span>
      <span className="min-w-0 truncate text-dense text-muted-foreground">{`${appointment.bay.name} · ${appointment.technician.name}`}</span>
    </button>
  )
}
