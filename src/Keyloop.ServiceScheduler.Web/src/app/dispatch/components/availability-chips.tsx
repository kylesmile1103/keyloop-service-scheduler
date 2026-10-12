import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import { useQuery } from "@tanstack/react-query"
import { ChevronRight } from "lucide-react"
import type { ReactNode } from "react"

import { getAvailabilityOptions } from "@/api/@tanstack/react-query.gen"
import type { AvailabilitySlotResponse, ServiceTypeResponse } from "@/api/types.gen"
import { IllustratedState } from "@/components/illustrated-state"
import { ProblemAlert } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { fieldErrors, parseProblem } from "@/lib/problem-details"
import { cn } from "@/lib/utils"

import { localTime } from "../lib/appointment-text"
import { formatDay } from "../lib/calendar-date"

/** A slot chip (DESIGN_SYSTEM 11.6): 40 px, 44 px on touch; selected chips take the primary fill. */
const chip =
  "group/slot inline-flex min-h-10 min-w-20 cursor-pointer flex-col items-center justify-center rounded-chip border border-input bg-card px-2 py-1 text-sm leading-tight font-medium tabular-nums outline-none transition-colors duration-100 pointer-coarse:min-h-11 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

/** The chip's second line; on a selected chip it switches to the fill's own ink (muted text there would be 3.06:1). */
const chipLine = "text-xs font-normal text-muted-foreground"

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`

/** "3 bays · 2 techs": how much capacity is left at a start. */
function capacity(slot: Pick<AvailabilitySlotResponse, "freeBays" | "freeTechnicians">): string {
  return `${plural(slot.freeBays, "bay")} · ${plural(slot.freeTechnicians, "tech")}`
}


interface AvailabilityChipsProps {
  dealershipId: string
  /** The chosen service; until there is one, the chips ask for it. */
  serviceType: ServiceTypeResponse | undefined
  /** The local date, `yyyy-MM-dd`. */
  date: string
  /** The chosen start (`startUtc`), or empty. */
  value: string
  onValueChange: (startUtc: string) => void
  /** The id of the label that names the group ("Start time"). */
  labelledBy: string
  /** The id of the error under the group, when there is one. */
  describedBy?: string
  invalid?: boolean
  /** Offered when the day has no free slot: the next day worth trying. */
  nextDate?: string | null
  onDateChange?: (date: string) => void
}

/**
 * The free start times of a service on a day (`GET /availability`) as a radio group of chips, grouped Morning and Afternoon,
 * each with its local time and remaining capacity. Arrow keys move between chips, Space chooses, Tab enters and leaves the
 * group. Only bookable starts are drawn; a day without one says why and offers the next day.
 */
export function AvailabilityChips({
  dealershipId,
  serviceType,
  date,
  value,
  onValueChange,
  labelledBy,
  describedBy,
  invalid = false,
  nextDate,
  onDateChange,
}: AvailabilityChipsProps) {
  const availability = useQuery({
    ...getAvailabilityOptions({ path: { dealershipId }, query: { serviceTypeId: serviceType?.id ?? "", date } }),
    enabled: Boolean(serviceType),
  })

  if (!serviceType) return <Hint>Choose a service to see its free start times.</Hint>

  if (availability.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        <p role="status" className="sr-only">
          Looking for free start times…
        </p>
        <Skeleton className="h-4 w-20" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-11 w-20 rounded-chip" />
          ))}
        </div>
      </div>
    )
  }

  if (availability.isError) {
    const problem = parseProblem(availability.error)
    const dateError = problem && fieldErrors(problem, { date: "Date" }).date
    // A date the API will not plan (before yesterday or past the booking horizon) is the user's to change, not a failure.
    return dateError ? (
      <Hint>{dateError}</Hint>
    ) : (
      <ProblemAlert
        title="Couldn’t look up free times"
        error={availability.error}
        onRetry={() => void availability.refetch()}
        retrying={availability.isFetching}
      />
    )
  }

  const { slots, unavailableReason } = availability.data
  if (slots.length === 0) {
    const day = formatDay(date, "long").replace(/ \d{4}$/, "")
    const reason =
      unavailableReason === "closed"
        ? `The workshop is closed on ${day}.`
        : unavailableReason === "no-qualified-resources"
          ? `This dealership has no bay and technician that can do ${serviceType.name}.`
          : `Every bay and technician that can do it is booked on ${day}.`
    return (
      <IllustratedState
        illustration="no-availability"
        title={`No free slot for ${serviceType.name}`}
        className="py-4"
        action={
          nextDate &&
          onDateChange &&
          unavailableReason !== "no-qualified-resources" && (
            <Button type="button" variant="signal" onClick={() => onDateChange(nextDate)}>
              {`Try ${formatDay(nextDate, "long").replace(/ \d{4}$/, "")}`}
              <ChevronRight aria-hidden="true" />
            </Button>
          )
        }
      >
        <p>{reason}</p>
      </IllustratedState>
    )
  }

  const groups = [
    { name: "Morning", slots: slots.filter((slot) => Number(localTime(slot.startLocal).slice(0, 2)) < 12) },
    { name: "Afternoon", slots: slots.filter((slot) => Number(localTime(slot.startLocal).slice(0, 2)) >= 12) },
  ].filter((group) => group.slots.length > 0)

  return (
    <RadioGroup
      value={value || null}
      onValueChange={(next) => typeof next === "string" && onValueChange(next)}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      className="flex flex-col gap-3"
    >
      {groups.map((group) => (
        <div key={group.name} className="flex flex-col gap-2">
          {/* The times say which part of the day they are in; the heading only helps the eye. */}
          <p aria-hidden="true" className="text-xs font-medium text-muted-foreground">
            {group.name}
          </p>
          {/* Equal columns that fill the row: three to a phone, more on wider screens. */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">
            {group.slots.map((slot) => (
              <Radio.Root
                key={slot.startUtc}
                value={slot.startUtc}
                aria-label={`${localTime(slot.startLocal)}, ${plural(slot.freeBays, "bay")} and ${plural(slot.freeTechnicians, "technician")} free`}
                className={cn(
                  chip,
                  "hover:not-data-checked:bg-accent data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground"
                )}
              >
                <span>{localTime(slot.startLocal)}</span>
                <span className={cn(chipLine, "group-data-checked/slot:text-primary-foreground/80")}>{capacity(slot)}</span>
              </Radio.Root>
            ))}
          </div>
        </div>
      ))}
    </RadioGroup>
  )
}

/**
 * A conflict's suggested starts (the 409's `suggestedSlots`) as the same chips, but as plain buttons: one click books at
 * that time.
 */
export function SuggestedSlotChips({
  slots,
  onPick,
  disabled = false,
}: {
  slots: ReadonlyArray<{ startUtc: string; startLocal: string }>
  onPick: (slot: { startUtc: string; startLocal: string }) => void
  disabled?: boolean
}) {
  return (
    <ul aria-label="Suggested start times" className="flex flex-wrap gap-2">
      {slots.map((slot) => (
        <li key={slot.startUtc}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(slot)}
            aria-label={`Book at ${localTime(slot.startLocal)} instead`}
            className={cn(chip, "text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-50")}
          >
            <span>{localTime(slot.startLocal)}</span>
            <span className={chipLine}>Book this time</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="rounded-chip border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">{children}</p>
}
