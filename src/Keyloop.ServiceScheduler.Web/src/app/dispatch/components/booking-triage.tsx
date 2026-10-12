import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import { CalendarDays, CalendarX2, Check, CircleAlert, LoaderCircle, MessageSquareText, ScanSearch } from "lucide-react"
import { useEffect, useId, useLayoutEffect, useRef } from "react"

import type { DealershipResponse, ServiceTypeResponse, TriageBookingResponse, TriageServiceCandidate } from "@/api/types.gen"
import { CapabilityBadges } from "@/components/capability-badges"
import { ProblemAlert } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { formatDay, weekdayOf } from "@/lib/calendar-date"
import { featureList } from "@/lib/features"
import { illustrationAlt, illustrations } from "@/lib/illustrations"
import { openingHoursOn } from "@/lib/opening-hours"
import { authRefusalTitle, parseProblem, problemSlug, UnexpectedResponseError } from "@/lib/problem-details"
import { serviceHelp } from "@/lib/service-help"
import { cn } from "@/lib/utils"

import type { BookingTriage, TriageAnswer } from "../hooks/use-booking-triage"
import { inspectionAction, inspectionService, NO_MATCH, noMatchNextSteps, phraseOf } from "../lib/triage-copy"

interface BookingTriageProps {
  triage: BookingTriage
  dealership: DealershipResponse
  today: string
  /** The dealership's catalogue, for each candidate's needs (badges) and whether it can be booked here. */
  serviceTypes: ServiceTypeResponse[] | undefined
  /** What step 1 holds now, so a suggestion already in use says so. */
  current: { serviceTypeId: string; date: string }
  /** Notes already holds the person's own text, so ticking the box copies nothing (it never overwrites). */
  notesHaveOwnText: boolean
  /** "Use this": the service, and the day asked for when it is still to come and the workshop is open then. */
  onUse: (serviceTypeId: string, date: string | null) => void
  /**
   * The id of the reason this account can no longer ask for suggestions (signed out, or a role that cannot book): Suggest a
   * service and the photos are then unavailable and name it (UI_DESIGN 11.20). Nothing is uploaded or asked meanwhile.
   */
  blockedBy?: string
}

/**
 * Booking intake triage in step 1 (ARCHITECTURE §8.10, §15): the issue in the customer's words, "Suggest a service", and
 * the answer as cards to choose from: the likely service (chosen, but never used without the person's "Use this"), the
 * possible ones (nothing chosen when the model is unsure), or a plain no-match with what to do next. Using one sets the
 * service and, when that day is still to come and the workshop is open then, the day asked for; the free starts for
 * them come next. A failure leaves the manual choice below as it is.
 */
export function BookingTriageIntake({ triage, dealership, today, serviceTypes, current, notesHaveOwnText, onUse, blockedBy }: BookingTriageProps) {
  const ids = { description: useId(), help: useId(), count: useId(), error: useId(), photos: useId(), photoHelp: useId(), photoError: useId() }
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const suggestRef = useRef<HTMLButtonElement>(null)
  const { answer, failure, pending, waiting, descriptionError, maxLength } = triage
  // A refused description is shown under the field, not as an alert.
  const alert = failure && !isValidation(failure) ? failure : null

  // The alert goes when its Try again is answered (with suggestions, or a description error), and its focused button goes
  // with it. Focus then moves to the description that was refused, or back to Suggest a service, instead of falling to
  // the dialog. A layout effect: in the same commit as the removal, before the dialog's focus guard takes lost focus.
  const hadAlert = useRef(false)
  useLayoutEffect(() => {
    const removed = hadAlert.current && !alert
    hadAlert.current = alert !== null
    if (!removed || (document.activeElement && document.activeElement !== document.body)) return
    ;(descriptionError ? descriptionRef.current : suggestRef.current)?.focus()
  }, [alert, descriptionError])

  function suggest() {
    if (blockedBy) return
    if (!triage.suggest()) descriptionRef.current?.focus()
  }

  const describedBy = [ids.help, ids.count, descriptionError ? ids.error : null].filter(Boolean).join(" ")
  const noPhotos = triage.photos.length === 0

  return (
    <section aria-label="Suggest a service from the issue" className="flex flex-col gap-3 rounded-xl border border-border p-3 sm:p-4">
      <Field data-invalid={descriptionError ? true : undefined} className="gap-1.5">
        <FieldLabel htmlFor={ids.description}>Describe the issue</FieldLabel>
        <Textarea
          ref={descriptionRef}
          id={ids.description}
          value={triage.description}
          onChange={(event) => triage.setDescription(event.target.value)}
          maxLength={maxLength}
          rows={2}
          autoComplete="off"
          aria-invalid={descriptionError ? true : undefined}
          aria-describedby={describedBy}
          placeholder="For example: brakes squeal, it's an EV, need it Thursday"
          className="min-h-16 scroll-mt-24"
        />
        <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
          <p id={ids.help}>In the customer’s own words, with the day they want if they said one.</p>
          <p id={ids.count} className="shrink-0 tabular-nums">
            <span aria-hidden="true">{`${triage.description.length}/${maxLength}`}</span>
            <span className="sr-only">{`${triage.description.length} of ${maxLength} characters`}</span>
          </p>
        </div>
        {descriptionError && (
          <FieldError id={ids.error} className="flex items-start gap-1.5">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{descriptionError}</span>
          </FieldError>
        )}
      </Field>

      {triage.imagesEnabled && (
        <Field className="gap-1.5" data-invalid={triage.imageError ? true : undefined}>
          <FieldLabel htmlFor={ids.photos}>Photos or paperwork (optional)</FieldLabel>
          {/*
            Before the first photo, the field says what is worth photographing, beside the picture of it (UI_DESIGN 12.1).
            The file input keeps its place in this wrapper either way, so the element the file picker returns focus to is
            never replaced when the photos arrive.
          */}
          <div
            className={cn(
              noPhotos &&
                "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 rounded-lg border border-dashed border-input p-3"
            )}
          >
            {noPhotos && (
              <img
                src={illustrations["photo-evidence"]}
                alt={illustrationAlt["photo-evidence"]}
                width={1200}
                height={900}
                draggable={false}
                className="pointer-events-none h-auto w-20 select-none sm:row-span-2 sm:w-24"
              />
            )}
            {noPhotos && (
              <p className="text-sm text-pretty">A photo of the warning light, the damage or the paperwork helps find the right service.</p>
            )}
            <input
              id={ids.photos}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              disabled={pending || Boolean(blockedBy)}
              aria-invalid={triage.imageError ? true : undefined}
              aria-describedby={[ids.photoHelp, triage.imageError ? ids.photoError : null, blockedBy].filter(Boolean).join(" ")}
              className={cn(
                "w-full min-w-0 text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-2 file:text-sm file:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
                noPhotos && "col-span-2 sm:col-span-1"
              )}
              onChange={(event) => { triage.addPhotos(Array.from(event.target.files ?? [])); event.target.value = "" }}
            />
          </div>
          <p id={ids.photoHelp} className="text-xs text-muted-foreground">
            Up to {triage.maxImages} PNG, JPEG or WebP photos, 4 MiB and 16 megapixels each, 8 MiB total. Uploads expire after one hour.
          </p>
          {triage.imageError && <FieldError id={ids.photoError}>{triage.imageError}</FieldError>}
          {triage.photos.length > 0 && (
            <ul aria-label="Selected photos" className="flex flex-col gap-2">
              {triage.photos.map((photo, index) => (
                <li key={`${photo.name}-${photo.lastModified}-${index}`} className="flex items-center gap-3 rounded-lg border border-border p-2">
                  <PhotoPreview photo={photo} />
                  <span className="min-w-0 flex-1 truncate text-sm">{photo.name}</span>
                  <Button type="button" variant="ghost" disabled={pending} onClick={() => triage.removePhoto(index)} aria-label={`Remove photo ${index + 1}: ${photo.name}`}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Field>
      )}

      <div className="flex flex-col gap-x-4 gap-y-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <Button
          ref={suggestRef}
          type="button"
          variant="outline"
          onClick={suggest}
          // Focusable while it asks (or waits out a rate limit): it was just pressed, and focus must stay in the dialog.
          disabled={pending || waiting > 0 || Boolean(blockedBy)}
          focusableWhenDisabled
          aria-busy={pending || undefined}
          aria-describedby={blockedBy}
          className="self-start"
        >
          {pending ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <ScanSearch aria-hidden="true" />}
          {pending ? "Suggesting…" : waiting > 0 ? `Suggest a service (in ${waiting} s)` : "Suggest a service"}
        </Button>
        <Label className="flex min-h-9 cursor-pointer items-center gap-2.5 font-normal max-md:min-h-11 pointer-coarse:min-h-11">
          <Checkbox checked={triage.copyToNotes} onCheckedChange={(checked) => triage.setCopyToNotes(checked)} />
          Copy the description into Notes
        </Label>
      </div>
      {notesHaveOwnText && triage.copyToNotes && triage.description.trim() !== "" && (
        <p className="text-xs text-muted-foreground">Notes already has other text, so the description is not copied into it.</p>
      )}
      <p className="text-xs text-pretty text-muted-foreground">Suggestions by {triage.provider}. Check before booking.</p>

      {/* Always on the page, so what each answer says is read out as it arrives. */}
      <p role="status" className="sr-only">
        {pending ? "Looking for matching services…" : answer ? announcement(answer.response, dealership, today, serviceTypes) : ""}
      </p>

      {alert && (
        <TriageProblem
          error={alert}
          waiting={waiting}
          retrying={pending}
          blockedBy={blockedBy}
          onRetry={() => {
            if (!blockedBy) triage.retry()
          }}
        />
      )}

      {answer && (
        <Suggestions
          answer={answer}
          stale={answer.description !== triage.description.trim() || answer.imageVersion !== triage.imageVersion}
          pending={pending}
          selected={triage.selected}
          onSelect={triage.setSelected}
          dealership={dealership}
          today={today}
          serviceTypes={serviceTypes}
          current={current}
          onUse={onUse}
        />
      )}
    </section>
  )
}

function PhotoPreview({ photo }: { photo: File }) {
  const ref = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const url = URL.createObjectURL(photo)
    if (ref.current) ref.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [photo])
  return <img ref={ref} alt={`Selected photo: ${photo.name}`} className="size-12 rounded-md object-cover" />
}

/** A candidate as the cards show it: its catalogue entry (for the badges) and whether it can be booked here, or why not. */
interface Candidate extends TriageServiceCandidate {
  entry: ServiceTypeResponse | undefined
  usable: boolean
  /** Why it cannot be chosen, when it cannot. */
  reason: string | null
  likelihood: "Likely" | "Possible"
  percent: number
}

function candidatesOf(response: TriageBookingResponse, serviceTypes: ServiceTypeResponse[] | undefined): Candidate[] {
  return response.services.map((candidate, index) => {
    const entry = serviceTypes?.find((service) => service.id === candidate.serviceType.id)
    // The API suggests only what the dealership can book; the catalogue on screen has the last word.
    const reason =
      serviceTypes === undefined
        ? "Waiting for this dealership’s services"
        : entry === undefined
          ? "Not in this dealership’s services"
          : entry.bookable
            ? null
            : "Not offered here: no qualified bay or technician"
    return {
      ...candidate,
      entry,
      usable: reason === null,
      reason,
      // "Likely" is the one suggestion the model is confident about; every other candidate is only possible.
      likelihood: response.recommendation === "suggest" && index === 0 ? "Likely" : "Possible",
      percent: Math.round(candidate.probability * 100),
    }
  })
}

/** Why "Use this" leaves the day asked for alone: it has passed (an answer from before midnight), or the workshop is closed. */
type DayNotUsed = "passed" | "closed"

/** The day asked for, and why "Use this" leaves it alone, if it does: only a day from today on that the workshop opens is set. */
function dayAskedFor(response: TriageBookingResponse, dealership: DealershipResponse, today: string) {
  const date = response.preferredDate?.date
  if (!date) return null
  const notUsed: DayNotUsed | null = date < today ? "passed" : openingHoursOn(dealership, weekdayOf(date)) === null ? "closed" : null
  return { date, notUsed }
}

const dayName = (date: string) => formatDay(date, "long").replace(/ \d{4}$/, "")

/** What the status region reads out for an answer: the cards, or the no-match and its next step, as the screen says them. */
function announcement(
  response: TriageBookingResponse,
  dealership: DealershipResponse,
  today: string,
  serviceTypes: ServiceTypeResponse[] | undefined
): string {
  const candidates = candidatesOf(response, undefined)
  if (response.recommendation === "no-match" || candidates.length === 0) {
    const issue = response.uncoveredIssue
    const inspection = inspectionService(serviceTypes)
    const mentioned = issue ? `Mentioned: ${phraseOf(issue.category)}. ` : ""
    const next = inspection ? `${inspectionAction(inspection)}, choose a service below or contact the workshop.` : noMatchNextSteps(false)
    return `${NO_MATCH} ${mentioned}${next}`
  }
  const day = dayAskedFor(response, dealership, today)
  const why = day?.notUsed === "passed" ? ", which has passed" : day?.notUsed === "closed" ? ", when the workshop is closed" : ""
  const asked = day ? `Asked for ${dayName(day.date)}${why}. ` : ""
  if (response.recommendation === "suggest") {
    const [top] = candidates
    return `Likely: ${top.serviceType.name}, ${top.percent}%. ${asked}Check it, then choose Use this.`
  }
  const names = candidates.map((candidate) => candidate.serviceType.name).join(", ")
  return candidates.length === 1
    ? `One service could fit: ${names}. ${asked}Choose it if it matches, then choose Use this.`
    : `${candidates.length} services could fit: ${names}. ${asked}Choose one, then choose Use this.`
}

/** The headline over the matched cards, in the same plain words, for one card or several. */
function headline(response: TriageBookingResponse, count: number): string {
  if (response.recommendation === "suggest") {
    return count === 1 ? "This service fits the description. Check it, then use it." : "One service fits best. Check it, then use it."
  }
  return count === 1
    ? "This service could fit. Choose it if it matches, then use it."
    : "These services could fit. Choose the one that matches, then use it."
}

interface SuggestionsProps {
  answer: TriageAnswer
  /** The description has changed since this answer. */
  stale: boolean
  /** Another answer is on its way: the cards wait for it. */
  pending: boolean
  selected: string | null
  onSelect: (serviceTypeId: string | null) => void
  dealership: DealershipResponse
  today: string
  serviceTypes: ServiceTypeResponse[] | undefined
  current: { serviceTypeId: string; date: string }
  onUse: (serviceTypeId: string, date: string | null) => void
}

function Suggestions({
  answer,
  stale,
  pending,
  selected,
  onSelect,
  dealership,
  today,
  serviceTypes,
  current,
  onUse,
}: SuggestionsProps) {
  const { response } = answer
  const candidates = candidatesOf(response, serviceTypes)
  const day = dayAskedFor(response, dealership, today)
  // Only a candidate this dealership can book can be chosen (a "suggest" preselects its likely one only if so).
  const chosen = candidates.find((candidate) => candidate.serviceType.id === selected && candidate.usable) ?? null
  const usableDate = day && day.notUsed === null ? day.date : null
  const inUse = chosen !== null && current.serviceTypeId === chosen.serviceType.id && (usableDate === null || current.date === usableDate)
  const matched = response.recommendation !== "no-match" && candidates.length > 0

  return (
    <div aria-busy={pending || undefined} className="flex flex-col gap-3 border-t border-border pt-3">
      {matched ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-pretty">{headline(response, candidates.length)}</p>
          {stale && <StaleNote />}
        </div>
      ) : (
        <NoMatch response={response} serviceTypes={serviceTypes} current={current} stale={stale} pending={pending} onUse={onUse} />
      )}

      {matched && (
        <RadioGroup
          aria-label="Suggested services"
          value={chosen?.serviceType.id ?? null}
          onValueChange={(value) => onSelect(typeof value === "string" ? value : null)}
          disabled={pending || stale}
          className="flex flex-col gap-2"
        >
          {candidates.map((candidate) => (
            <CandidateCard key={candidate.serviceType.id} candidate={candidate} />
          ))}
        </RadioGroup>
      )}

      {matched && day && <DayAskedFor date={day.date} notUsed={day.notUsed} />}

      {matched && (
        <div>
          <Button
            type="button"
            variant="signal"
            onClick={() => !stale && chosen && onUse(chosen.serviceType.id, usableDate)}
            // Nothing chosen yet ("confirm"), or already in use: it waits, focusable, with the reason written above it.
            disabled={chosen === null || inUse || pending || stale}
            focusableWhenDisabled
          >
            {inUse && <Check aria-hidden="true" />}
            {inUse ? "In use" : "Use this"}
          </Button>
        </div>
      )}
    </div>
  )
}

function StaleNote() {
  return (
    <p className="text-xs text-pretty text-muted-foreground">
      The description or photos have changed since these suggestions. Suggest again to update them.
    </p>
  )
}

interface NoMatchProps {
  response: TriageBookingResponse
  serviceTypes: ServiceTypeResponse[] | undefined
  current: { serviceTypeId: string; date: string }
  stale: boolean
  pending: boolean
  onUse: (serviceTypeId: string, date: string | null) => void
}

/**
 * No bookable service matches: said plainly, with what was described in its fixed words when the answer names it, and the
 * next steps. The inspection (Diagnostic Fault Finding, by its catalogue code) is offered as an action only while this
 * dealership can book it; choosing it works as *Use this* does, for the service alone (a no-match applies no day).
 */
function NoMatch({ response, serviceTypes, current, stale, pending, onUse }: NoMatchProps) {
  const inspection = inspectionService(serviceTypes)
  const issue = response.uncoveredIssue
  const inUse = inspection !== null && current.serviceTypeId === inspection.id

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-pretty">{NO_MATCH}</p>
        {stale && <StaleNote />}
      </div>
      {issue && (
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Mentioned</span>{" "}
          <span className="inline-flex min-h-7 items-center gap-1.5 rounded-chip border border-input bg-card px-2.5 py-1 text-sm font-medium">
            <MessageSquareText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span>{phraseOf(issue.category)}</span>
          </span>
        </p>
      )}
      {inspection && (
        <Button
          type="button"
          variant="signal"
          onClick={() => !stale && !inUse && onUse(inspection.id, null)}
          disabled={inUse || pending || stale}
          focusableWhenDisabled
          // A long name wraps on a phone rather than running out of the section.
          className="h-auto min-h-10 max-w-full self-start py-2 text-left whitespace-normal pointer-coarse:min-h-11"
        >
          {inUse && <Check aria-hidden="true" />}
          {inUse ? `${inspection.name} in use` : inspectionAction(inspection)}
        </Button>
      )}
      <p className="text-xs text-pretty text-muted-foreground">{noMatchNextSteps(inspection !== null)}</p>
    </div>
  )
}

/**
 * One suggested service as a card in a radio group (arrow keys move, Space chooses): its name, duration, help line (for a
 * service whose name alone could mislead) and needs, and how likely it is: "Likely" or "Possible" with the percentage, and
 * a thin meter to compare the cards at a glance.
 */
function CandidateCard({ candidate }: { candidate: Candidate }) {
  const descriptionId = useId()
  const helpId = useId()
  const { serviceType, entry, usable, reason, likelihood, percent } = candidate
  const needs = entry ? featureList(entry.requiredBayCapabilities, entry.requiredCertifications, true) : []
  const help = serviceHelp(serviceType.code)
  // Described by its help line, then by why it cannot be chosen, or else by what it needs (when it needs more than every
  // bay and technician has).
  const described = [help ? helpId : null, !usable || needs.length > 0 ? descriptionId : null].filter(Boolean).join(" ") || undefined

  return (
    <Radio.Root
      value={serviceType.id}
      disabled={!usable}
      aria-label={`${serviceType.name}, ${serviceType.durationMinutes} min, ${likelihood} ${percent}%`}
      aria-describedby={described}
      className={cn(
        "group/candidate grid min-h-14 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 rounded-chip border border-input bg-card p-3 text-left outline-none transition-colors duration-100",
        "hover:not-data-checked:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "data-checked:border-primary data-checked:ring-1 data-checked:ring-primary",
        "data-disabled:cursor-not-allowed data-disabled:border-dashed data-disabled:hover:bg-card"
      )}
    >
      {/* The radio's own mark, so the choice never rests on the border alone. */}
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-4 items-center justify-center rounded-full border border-input bg-card group-data-checked/candidate:border-primary group-data-checked/candidate:bg-primary"
      >
        <span className="size-1.5 rounded-full bg-primary-foreground opacity-0 group-data-checked/candidate:opacity-100" />
      </span>
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm leading-snug font-semibold">{serviceType.name}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{`${serviceType.durationMinutes} min`}</span>
        </span>
        {help && (
          <span id={helpId} className="text-xs text-pretty text-muted-foreground">
            {help}
          </span>
        )}
        {usable ? (
          needs.length > 0 && entry && (
            <CapabilityBadges
              capabilities={entry.requiredBayCapabilities}
              certifications={entry.requiredCertifications}
              distinctiveOnly
              label="Needs"
              max={3}
              descriptionId={descriptionId}
              // Wrapped rather than cut short: a phone's card is narrow, and a need is worth reading whole.
              className="flex-wrap"
            />
          )
        ) : (
          <span id={descriptionId} className="text-xs text-muted-foreground">
            {reason}
          </span>
        )}
      </span>
      <span className="flex w-20 flex-col items-end gap-1.5 pt-0.5">
        <span className="flex items-baseline gap-1.5">
          <span className={cn("text-xs", likelihood === "Likely" ? "font-semibold text-foreground" : "text-muted-foreground")}>
            {likelihood}
          </span>
          <span className="font-heading text-sm font-bold tabular-nums">{`${percent}%`}</span>
        </span>
        <span aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <span className="block h-full rounded-full bg-chart-1" style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }} />
        </span>
      </span>
    </Radio.Root>
  )
}

/** The day asked for: a chip, struck through with the reason when it has passed or the workshop is closed then (it is not applied). */
function DayAskedFor({ date, notUsed }: { date: string; notUsed: DayNotUsed | null }) {
  const Icon = notUsed === null ? CalendarDays : CalendarX2
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Day asked for</span>
        <span
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-chip border border-input bg-card px-2.5 text-sm font-medium tabular-nums",
            notUsed !== null && "text-muted-foreground line-through"
          )}
        >
          <Icon aria-hidden="true" className="size-4 shrink-0" />
          <span>{formatDay(date, "short")}</span>
        </span>
      </div>
      {notUsed !== null && (
        <p className="text-xs text-pretty text-muted-foreground">
          {notUsed === "passed"
            ? "That day has passed, so the date is not changed."
            : `The workshop is closed on ${weekdayOf(date)}s, so the date is not changed.`}
        </p>
      )}
    </div>
  )
}

/** A `400` about the description: its message goes under the field (`descriptionError`), not into an alert. */
function isValidation(error: unknown): boolean {
  const problem = parseProblem(error)
  return problem !== null && problemSlug(problem) === "validation-error"
}

interface TriageProblemProps {
  error: unknown
  waiting: number
  retrying: boolean
  /** As Suggest a service's: the id of the reason this account cannot ask any more; Try again is then unavailable and names it. */
  blockedBy?: string
  onRetry: () => void
}

/**
 * Why there are no suggestions, in the shared problem alert (UI_DESIGN 11.16): a rate limit waits (Suggest a service
 * counts down), a refusal says what the API said, and any other failure (`503 triage-unavailable`, the network) offers
 * Try again with the same description, unavailable with Suggest a service's reason when the account cannot ask. Manual
 * selection below works throughout.
 */
function TriageProblem({ error, waiting, retrying, blockedBy, onRetry }: TriageProblemProps) {
  const problem = parseProblem(error)
  const status = problem?.status ?? (error instanceof UnexpectedResponseError ? error.status : undefined)

  if (status === 429) {
    return (
      <ProblemAlert
        tone="info"
        title={waiting > 0 ? `Too many requests - try again in ${waiting} s` : "Too many requests - try again now"}
        error={error}
      />
    )
  }
  // Signed out or refused for the role: the app's session prompt says what to do (components/auth/session-watch.tsx).
  if (status === 401 || status === 403) {
    return <ProblemAlert tone="warning" title={authRefusalTitle(status, "suggest a service")} error={error} />
  }
  if (status !== undefined && status < 500 && !(problem && problemSlug(problem) === "triage-unavailable")) {
    return <ProblemAlert tone="warning" title={problem?.title ?? `The server answered ${status}`} error={error} />
  }
  return (
    <ProblemAlert
      title="Couldn’t suggest a service"
      error={error}
      onRetry={onRetry}
      retrying={retrying}
      retryDisabled={Boolean(blockedBy)}
      retryDescribedBy={blockedBy}
    />
  )
}
