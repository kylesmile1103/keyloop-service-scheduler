import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import { useQuery } from "@tanstack/react-query"
import { CarFront, ChevronRight, Info } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"

import { getAvailabilityOptions } from "@/api/@tanstack/react-query.gen"
import type { AvailabilityResponse, AvailabilitySlotResponse, ServiceTypeResponse } from "@/api/types.gen"
import { IllustratedState } from "@/components/illustrated-state"
import { ProblemAlert } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useQueryFailure } from "@/hooks/use-query-failure"
import { formatDay } from "@/lib/calendar-date"
import { formatLocalTime } from "@/lib/local-time"
import { fieldErrors, parseProblem, problemSlug } from "@/lib/problem-details"
import { cn } from "@/lib/utils"
import { type AvailabilityVehicle, availabilityVehicleQuery, vehicleNeeds, vehicleQueryPhrase } from "@/lib/vehicle-aware"

import { localTime } from "../lib/appointment-text"

const chip =
  "group/slot inline-flex min-h-10 min-w-20 cursor-pointer flex-col items-center justify-center rounded-chip border border-input bg-card px-2 py-1 text-sm leading-tight font-medium tabular-nums outline-none transition-colors duration-100 pointer-coarse:min-h-11 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

const chipLine = "text-xs font-normal text-muted-foreground"

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`

function capacity(slot: Pick<AvailabilitySlotResponse, "freeBays" | "freeTechnicians">): string {
  return `${plural(slot.freeBays, "bay")} · ${plural(slot.freeTechnicians, "tech")}`
}

interface AvailabilityChipsProps {
  dealershipId: string
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
  /** Incremented to move keyboard focus into the start times once rendered. */
  focusRequest?: number
  /** Vehicle attributes for vehicle-aware availability queries (excludes VIN, registration, and declaration reason). */
  vehicle?: AvailabilityVehicle
  /** Called when the API refuses vehicle parameters (`422 vehicle-aware-requirements-disabled`). */
  onVehicleRefused?: () => void
  /** Whether the hint should expand to fill its column height. */
  fill?: boolean
}

const vehicleKey = (vehicle: AvailabilityVehicle | undefined) => (vehicle ? JSON.stringify(availabilityVehicleQuery(vehicle)) : "")

/**
 * Renders bookable start times for a service on a day (`GET /availability`) as a Morning/Afternoon radio group of chips.
 */
export function AvailabilityChips({ dealershipId, focusRequest = 0, vehicle, onVehicleRefused, ...view }: AvailabilityChipsProps) {
  const { serviceType, date, value, onValueChange } = view
  const availabilityOptions = getAvailabilityOptions({
    path: { dealershipId },
    query: { serviceTypeId: serviceType?.id ?? "", date, ...(vehicle ? availabilityVehicleQuery(vehicle) : {}) },
  })
  const availability = useQuery({ ...availabilityOptions, enabled: Boolean(serviceType) })
  // Kept while Try again looks again, so the alert and its focused button stay in the dialog until the answer.
  const failure = useQueryFailure(availability, availabilityOptions.queryKey)
  const refused = failure !== null && problemSlug(parseProblem(failure) ?? {}) === "vehicle-aware-requirements-disabled"

  // A server that takes no vehicle parameters now: the dialog drops them, and the starts are read again without them.
  useEffect(() => {
    if (refused) onVehicleRefused?.()
  }, [refused, onVehicleRefused])

  // When the vehicle changes, the starts are read again for it, and the area says how the count changed, and that the
  // chosen start went if this vehicle cannot have it. Measured against the last answer for the same service and day.
  const signature = vehicleKey(vehicle)
  const count = availability.data?.slots.length
  const [shown, setShown] = useState<{ service: string; date: string; signature: string; count: number } | null>(null)
  const [change, setChange] = useState<{ from: number; to: number; lostStart: string | null } | null>(null)
  if (serviceType && count !== undefined && (shown?.service !== serviceType.id || shown.date !== date || shown.signature !== signature || shown.count !== count)) {
    const sameDay = shown?.service === serviceType.id && shown.date === date
    if (sameDay && shown.signature !== signature) {
      const lost = value !== "" && !availability.data!.slots.some((slot) => slot.startUtc === value) ? value : null
      setChange({ from: shown.count, to: count, lostStart: lost })
    } else setChange(null)
    setShown({ service: serviceType.id, date, signature, count })
  }
  // The chosen start this vehicle cannot have is cleared once, so Next asks for another.
  const lostStart = change?.lostStart ?? null
  const cleared = useRef<string | null>(null)
  useEffect(() => {
    if (lostStart === null || cleared.current === lostStart) return
    cleared.current = lostStart
    onValueChange("")
  }, [lostStart, onValueChange])
  const timeZone = availability.data?.timeZoneId

  const area = useRef<HTMLDivElement>(null)
  const handled = useRef(0)
  // The answer for this service and day is on screen (chips, the no-slot state or a failure), not the loading skeleton.
  const settled = serviceType !== undefined && (failure !== null || availability.data !== undefined)
  useEffect(() => {
    if (focusRequest === 0 || handled.current === focusRequest || !settled) return
    handled.current = focusRequest
    // One query each, in order of preference: a selector list would return whichever match comes first on the page.
    const target =
      area.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ??
      area.current?.querySelector<HTMLElement>('[role="radio"]') ??
      area.current?.querySelector<HTMLElement>("button")
    target?.focus()
  }, [focusRequest, settled])

  return (
    <div ref={area} className="contents">
      {vehicle && serviceType && (
        <div className="flex flex-col gap-1">
          <p className="flex items-start gap-1.5 text-xs text-pretty text-muted-foreground">
            <CarFront aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <span>{`Counted for ${vehicleQueryPhrase(vehicle)}.`}</span>
          </p>
          {/* Announced as it changes: why the counts are not what they were a moment ago. */}
          <p role="status" className="empty:hidden">
            {change && (
              <span className="flex items-start gap-1.5 rounded-lg bg-info-subtle px-2.5 py-1.5 text-xs text-pretty text-foreground">
                <Info aria-hidden="true" className="mt-px size-3.5 shrink-0 text-info" />
                <span>
                  {`Updated for this vehicle: ${change.to === 0 ? "no start" : plural(change.to, "start")} free, was ${change.from}.`}
                  {change.lostStart &&
                    value === "" &&
                    ` The start you chose${timeZone ? `, ${formatLocalTime(change.lostStart, timeZone)},` : ""} isn’t free for it: choose another.`}
                </span>
              </span>
            )}
          </p>
        </div>
      )}
      <AvailabilityView
        {...view}
        vehicle={vehicle}
        data={availability.data}
        failure={refused ? null : failure}
        retrying={availability.isFetching}
        onRetry={() => void availability.refetch()}
      />
    </div>
  )
}

interface AvailabilityViewProps extends Omit<AvailabilityChipsProps, "dealershipId" | "focusRequest" | "onVehicleRefused"> {
  data: AvailabilityResponse | undefined
  failure: unknown
  retrying: boolean
  onRetry: () => void
}

/** The start-time area for one answer of the availability read: a hint, its failure, the skeleton, no slot, or the chips. */
function AvailabilityView({
  serviceType,
  date,
  value,
  onValueChange,
  labelledBy,
  describedBy,
  invalid = false,
  nextDate,
  onDateChange,
  vehicle,
  fill = false,
  data,
  failure,
  retrying,
  onRetry,
}: AvailabilityViewProps) {
  if (!serviceType) return <Hint fill={fill}>Choose a service to see its free start times.</Hint>

  if (failure !== null) {
    const problem = parseProblem(failure)
    const dateError = problem && fieldErrors(problem, { date: "Date" }).date
    // A date the API will not plan (before yesterday or past the booking horizon) is the user's to change, not a failure.
    return dateError ? (
      <Hint fill={fill}>{dateError}</Hint>
    ) : (
      <ProblemAlert title="Couldn’t look up free times" error={failure} onRetry={onRetry} retrying={retrying} />
    )
  }

  if (data === undefined) {
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

  const { slots, unavailableReason } = data
  if (slots.length === 0) {
    const day = formatDay(date, "long").replace(/ \d{4}$/, "")
    // With a vehicle, "no qualified resources" can be the vehicle's doing (an HV level, a heavy lift, live working): the
    // answer does not say which need failed, so the area names what the vehicle adds, as a gap in the workshop.
    const vehicleGap = vehicle && unavailableReason === "no-qualified-resources" ? vehicleNeeds(vehicle) : []
    const reason =
      unavailableReason === "closed"
        ? `The workshop is closed on ${day}.`
        : unavailableReason === "no-qualified-resources"
          ? vehicleGap.length > 0
            ? `No bay and technician here can do ${serviceType.name} for this vehicle.`
            : `This dealership has no bay and technician that can do ${serviceType.name}.`
          : `Every bay and technician that can do it is booked on ${day}.`
    return (
      <IllustratedState
        illustration="no-availability"
        title={vehicleGap.length > 0 ? `No qualified bay and technician for ${serviceType.name}` : `No free slot for ${serviceType.name}`}
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
        {vehicleGap.length > 0 && (
          <>
            <p className="text-pretty">{`It needs ${vehicleGap.join(", and ")}.`}</p>
            <p className="text-pretty">
              That is a gap in what the workshop has, not a fault in this booking. Change the vehicle details above if
              they are not right.
            </p>
          </>
        )}
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
 * that time. While a booking is out they all wait, focusable (`focusableWhenDisabled`): the one that was pressed keeps
 * keyboard focus, and says it is booking.
 */
export function SuggestedSlotChips({
  slots,
  onPick,
  disabled = false,
  booking,
}: {
  slots: ReadonlyArray<{ startUtc: string; startLocal: string }>
  onPick: (slot: { startUtc: string; startLocal: string }) => void
  disabled?: boolean
  /** The start (`startUtc`) being booked, if it is one of these. */
  booking?: string
}) {
  return (
    <ul aria-label="Suggested start times" className="flex flex-wrap gap-2">
      {slots.map((slot) => {
        const pending = disabled && slot.startUtc === booking
        return (
          <li key={slot.startUtc}>
            <ButtonPrimitive
              type="button"
              disabled={disabled}
              focusableWhenDisabled
              onClick={() => onPick(slot)}
              aria-label={`Book at ${localTime(slot.startLocal)} instead`}
              aria-busy={pending || undefined}
              className={cn(chip, "text-foreground hover:bg-accent data-disabled:pointer-events-none data-disabled:opacity-50")}
            >
              <span>{localTime(slot.startLocal)}</span>
              <span className={chipLine}>{pending ? "Booking…" : "Book this time"}</span>
            </ButtonPrimitive>
          </li>
        )
      })}
    </ul>
  )
}

function Hint({ children, fill = false }: { children: ReactNode; fill?: boolean }) {
  return (
    <p
      className={cn(
        "rounded-chip border border-dashed border-border px-3 py-3 text-sm text-muted-foreground",
        fill && "flex flex-1 items-center justify-center text-center text-pretty"
      )}
    >
      {children}
    </p>
  )
}
