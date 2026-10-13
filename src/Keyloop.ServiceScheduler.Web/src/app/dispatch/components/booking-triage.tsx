import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import {
  CalendarDays,
  CalendarX2,
  Check,
  ChevronDown,
  CircleAlert,
  ImagePlus,
  Info,
  LoaderCircle,
  MessageSquareText,
  NotebookPen,
  ScanSearch,
} from "lucide-react"
import { type DragEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react"

import type { DealershipResponse, ServiceTypeResponse, TriageBookingResponse, TriageServiceCandidate, TriageUncoveredIssue } from "@/api/types.gen"
import { CapabilityBadges } from "@/components/capability-badges"
import { ProblemAlert } from "@/components/problem-alert"
import { Button, buttonVariants } from "@/components/ui/button"
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
import {
  alsoMentioned,
  inspectionAction,
  inspectionService,
  NO_MATCH,
  noMatchNextSteps,
  noticeApplies,
  notesLine,
  notesTooLong,
  phraseOf,
} from "../lib/triage-copy"

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
  /** The booking's notes as they stand, so a line already added says so. */
  notes: string
  /** A line *Add to Notes* left out, and how many characters too long the notes as they are would be with it. */
  notesRefusal: NotesRefusal | null
  /** *Add to Notes* on the notice of what else the description mentioned: its fixed line, added once. */
  onAddToNotes: (line: string) => void
  /** "Use this": the service, and the day asked for when it is still to come and the workshop is open then. */
  onUse: (serviceTypeId: string, date: string | null) => void
  /** Element id describing why triage actions are disabled for the current account. */
  blockedBy?: string
  /** Uses a denser layout for the wide two-column booking dialog. */
  compact?: boolean
}

/**
 * Booking intake triage in step 1: accepts customer issue text and optional photos, suggests matching services,
 * and flags uncovered issues that can be added to Notes.
 */
export function BookingTriageIntake({
  triage,
  dealership,
  today,
  serviceTypes,
  current,
  notesHaveOwnText,
  notes,
  notesRefusal,
  onAddToNotes,
  onUse,
  blockedBy,
  compact = false,
}: BookingTriageProps) {
  const ids = { description: useId(), help: useId(), count: useId(), error: useId() }
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const suggestRef = useRef<HTMLButtonElement>(null)
  const { answer, failure, pending, waiting, descriptionError, maxLength } = triage
  const alert = failure && !isValidation(failure) ? failure : null

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

  return (
    <section
      aria-label="Suggest a service from the issue"
      className={cn("flex flex-col gap-3 rounded-xl border border-border p-3", !compact && "sm:p-4")}
    >
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
          className={cn("scroll-mt-24", compact ? "min-h-14" : "min-h-16")}
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

      {triage.imagesEnabled && <PhotoField triage={triage} pending={pending} blockedBy={blockedBy} compact={compact} />}

      <div className={cn("flex flex-col", compact ? "gap-1.5" : "gap-3")}>
        <div className="flex flex-col gap-x-4 gap-y-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <Button
            ref={suggestRef}
            type="button"
            variant="outline"
            onClick={suggest}
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
      </div>

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
          notes={notes}
          notesRefusal={notesRefusal}
          onAddToNotes={onAddToNotes}
          onUse={onUse}
        />
      )}
    </section>
  )
}

const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files")

interface PhotoFieldProps {
  triage: BookingTriage
  pending: boolean
  blockedBy?: string
  compact: boolean
}

/** Optional photo upload field with drag-and-drop, file picker, and preview list. */
function PhotoField({ triage, pending, blockedBy, compact }: PhotoFieldProps) {
  const ids = { input: useId(), help: useId(), error: useId() }
  const disabled = pending || Boolean(blockedBy)
  const [dragging, setDragging] = useState(false)
  const [limitsOpen, setLimitsOpen] = useState(false)
  const depth = useRef(0)
  const noPhotos = triage.photos.length === 0

  function enter(event: DragEvent) {
    if (!carriesFiles(event)) return
    event.preventDefault()
    depth.current += 1
    if (!disabled) setDragging(true)
  }
  function over(event: DragEvent) {
    if (!carriesFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = disabled ? "none" : "copy"
  }
  function leave(event: DragEvent) {
    if (!carriesFiles(event)) return
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setDragging(false)
  }
  function drop(event: DragEvent) {
    if (!carriesFiles(event)) return
    event.preventDefault()
    depth.current = 0
    setDragging(false)
    if (!disabled) triage.addPhotos(Array.from(event.dataTransfer.files))
  }

  return (
    <Field
      className="group/photos gap-1.5"
      data-invalid={triage.imageError ? true : undefined}
      data-dragging={dragging || undefined}
      onDragEnter={enter}
      onDragOver={over}
      onDragLeave={leave}
      onDrop={drop}
    >
      {compact ? (
        <div className="flex items-center justify-between gap-3">
          <FieldLabel htmlFor={ids.input}>Photos or paperwork (optional)</FieldLabel>
          <button
            type="button"
            aria-expanded={limitsOpen}
            aria-controls={ids.help}
            onClick={() => setLimitsOpen((open) => !open)}
            className="-mr-1 flex min-h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:-my-2.5 pointer-coarse:min-h-11"
          >
            Limits
            <ChevronDown
              aria-hidden="true"
              className={cn("size-3.5 transition-transform duration-150 motion-reduce:transition-none", limitsOpen && "rotate-180")}
            />
          </button>
        </div>
      ) : (
        <FieldLabel htmlFor={ids.input}>Photos or paperwork (optional)</FieldLabel>
      )}
      <div
        className={cn(
          "rounded-lg border border-dashed border-input transition-colors duration-100",
          "group-data-dragging/photos:border-signal group-data-dragging/photos:bg-signal/10",
          !noPhotos
            ? "px-3 py-2"
            : compact
              ? "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2.5"
              : "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 p-3"
        )}
      >
        {noPhotos && (
          <img
            src={illustrations["photo-evidence"]}
            alt={illustrationAlt["photo-evidence"]}
            width={1200}
            height={900}
            draggable={false}
            className={cn("pointer-events-none h-auto select-none", compact ? "w-16" : "w-20 sm:row-span-2 sm:w-24")}
          />
        )}
        {noPhotos && (
          <p className="text-sm text-pretty">A photo of the warning light, the damage or the paperwork helps find the right service.</p>
        )}
        <div
          className={cn(
            "relative flex flex-wrap items-center gap-x-3 gap-y-1",
            noPhotos && (compact ? "flex-col items-end" : "col-span-2 sm:col-span-1 sm:col-start-2")
          )}
        >
          <input
            id={ids.input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            // An empty title keeps the browser's own tooltip (the chosen file names) from floating over the photos.
            title=""
            disabled={disabled}
            aria-invalid={triage.imageError ? true : undefined}
            aria-describedby={[ids.help, triage.imageError ? ids.error : null, blockedBy].filter(Boolean).join(" ")}
            className="peer sr-only"
            onChange={(event) => {
              triage.addPhotos(Array.from(event.target.files ?? []))
              event.target.value = ""
            }}
          />
          <label
            htmlFor={ids.input}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "cursor-pointer",
              "peer-focus-visible:border-ring peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
              "peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
            )}
          >
            <ImagePlus aria-hidden="true" />
            Add photos
          </label>
          {/* Only where a pointer can drag: a phone has nothing to drop. */}
          <span aria-hidden="true" className="hidden text-xs text-muted-foreground peer-disabled:opacity-50 pointer-fine:inline">
            or drop them here
          </span>
        </div>
      </div>
      <p id={ids.help} hidden={compact && !limitsOpen} className="text-xs text-muted-foreground">
        Up to {triage.maxImages} PNG, JPEG or WebP photos, 4 MiB and 16 megapixels each, 8 MiB total. Uploads expire after one hour.
      </p>
      {triage.imageError && <FieldError id={ids.error}>{triage.imageError}</FieldError>}
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

/** The name of the service an uncovered issue is outside, from the answer's candidates or else the catalogue. */
function outsideName(response: TriageBookingResponse, serviceTypes: ServiceTypeResponse[] | undefined): string | null {
  const id = response.uncoveredIssue?.outsideServiceTypeId
  if (!id) return null
  return response.services.find((candidate) => candidate.serviceType.id === id)?.serviceType.name ?? serviceTypes?.find((service) => service.id === id)?.name ?? null
}

/** What the status region reads out for an answer: the cards, what else was mentioned and the next step, as the screen says them. */
function announcement(
  response: TriageBookingResponse,
  dealership: DealershipResponse,
  today: string,
  serviceTypes: ServiceTypeResponse[] | undefined
): string {
  const candidates = candidatesOf(response, undefined)
  const issue = response.uncoveredIssue
  if (response.recommendation === "no-match" || candidates.length === 0) {
    const inspection = inspectionService(serviceTypes)
    const mentioned = issue ? `Mentioned: ${phraseOf(issue.category)}. ` : ""
    const next = inspection ? `${inspectionAction(inspection)}, choose a service below or contact the workshop.` : noMatchNextSteps(false)
    return `${NO_MATCH} ${mentioned}${next}`
  }
  const day = dayAskedFor(response, dealership, today)
  const why = day?.notUsed === "passed" ? ", which has passed" : day?.notUsed === "closed" ? ", when the workshop is closed" : ""
  const asked = day ? `Asked for ${dayName(day.date)}${why}. ` : ""
  // Read with the answer's first choice: a suggestion's likely service, or nothing chosen yet.
  const firstChoice = response.recommendation === "suggest" ? candidates[0].serviceType.id : null
  const also = issue && noticeApplies(issue, firstChoice) ? `${alsoMentioned(issue.category, outsideName(response, serviceTypes))} ` : ""
  if (response.recommendation === "suggest") {
    const [top] = candidates
    return `Likely: ${top.serviceType.name}, ${top.percent}%. ${asked}${also}Check it, then choose Use this.`
  }
  const names = candidates.map((candidate) => candidate.serviceType.name).join(", ")
  return candidates.length === 1
    ? `One service could fit: ${names}. ${asked}${also}Choose it if it matches, then choose Use this.`
    : `${candidates.length} services could fit: ${names}. ${asked}${also}Choose one, then choose Use this.`
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
  notes: string
  notesRefusal: NotesRefusal | null
  onAddToNotes: (line: string) => void
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
  notes,
  notesRefusal,
  onAddToNotes,
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
  const issue = response.uncoveredIssue
  const notice = matched && issue && noticeApplies(issue, chosen?.serviceType.id ?? null) ? issue : null

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

      {/*
        What else the description mentioned, beside the service it is outside. A polite region that stays on the page while
        the cards do, so the notice is read out when choosing a card brings it back (its first appearance is read with the
        answer, above); it never takes focus.
      */}
      {matched && (
        <div aria-live="polite" className="empty:hidden">
          {notice && (
            <AlsoMentioned
              issue={notice}
              outsideName={outsideName(response, serviceTypes)}
              notes={notes}
              notesRefusal={notesRefusal}
              disabled={pending || stale}
              onAddToNotes={onAddToNotes}
            />
          )}
        </div>
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

/** A line *Add to Notes* left out, and by how many characters the notes as they are now would pass their limit with it. */
interface NotesRefusal {
  line: string
  over: number
}

interface AlsoMentionedProps {
  issue: TriageUncoveredIssue
  /** The service it is outside, when the answer names one the screen knows. */
  outsideName: string | null
  notes: string
  notesRefusal: NotesRefusal | null
  /** The answer is out of date or another is on its way, as for Use this. */
  disabled: boolean
  onAddToNotes: (line: string) => void
}

/**
 * "Also mentioned: …": a further problem in the description that the suggested service does not cover, in its fixed words
 * (never the model's), with *Add to Notes*, which writes its line into the booking's notes once and then says so in place.
 * When the line would take the notes past their limit nothing is written, and the note says by how much to shorten them,
 * in its polite region and tied to the button, which keeps focus.
 */
function AlsoMentioned({ issue, outsideName, notes, notesRefusal, disabled, onAddToNotes }: AlsoMentionedProps) {
  const refusalId = useId()
  const line = notesLine(issue.category)
  const added = notes.split("\n").some((existing) => existing.trim() === line)
  const over = !added && notesRefusal?.line === line ? notesRefusal.over : null
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-info/30 bg-info-subtle px-3 py-2.5 text-sm text-foreground">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
      <div className="flex min-w-0 flex-col items-start gap-2">
        <p className="text-pretty">{alsoMentioned(issue.category, outsideName)}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => !added && !disabled && onAddToNotes(line)}
          // Added, it stays where it is, focusable, saying so: the line is in the notes once.
          disabled={added || disabled}
          focusableWhenDisabled
          aria-describedby={over !== null ? refusalId : undefined}
          className="bg-background"
        >
          {added ? <Check aria-hidden="true" /> : <NotebookPen aria-hidden="true" />}
          {added ? "Added to Notes" : "Add to Notes"}
        </Button>
        {over !== null && (
          <p id={refusalId} className="flex items-start gap-1.5 text-pretty text-destructive">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{notesTooLong(over)}</span>
          </p>
        )}
      </div>
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

/** Displays triage request failures with rate-limit countdowns or retry controls. */
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
