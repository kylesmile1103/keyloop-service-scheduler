import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Ban, CarFront, ChevronDown, ClipboardList, LoaderCircle, type LucideIcon, Route, StickyNote, UserRound, XIcon } from "lucide-react"
import { type FormEvent, type ReactNode, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from "react"

import {
  cancelAppointmentMutation,
  getAppointmentOptions,
  getAppointmentQueryKey,
  getAvailabilityQueryKey,
  getServiceTypesOptions,
  getWorkshopScheduleOptions,
  getWorkshopScheduleQueryKey,
} from "@/api/@tanstack/react-query.gen"
import type { AppointmentResponse, GetAvailabilityData } from "@/api/types.gen"
import vehiclePlaceholder from "@/assets/illustrations/vehicle-placeholder.webp"
import { SignInPanel } from "@/components/auth/sign-in-prompt"
import { WriteReason } from "@/components/auth/write-reason"
import { CompetenceWarningNotice } from "@/components/competence-warning"
import { CopyButton } from "@/components/copy-button"
import { HvLevelBadge } from "@/components/hv-level"
import { InitialsAvatar } from "@/components/initials-avatar"
import { ProblemAlert } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { type DetailsAccess, detailsAccessOf, useCurrentUser, type WriteAccess, writeAccessOf } from "@/hooks/use-current-user"
import { useQueryFailure } from "@/hooks/use-query-failure"
import { useUnsavedWork } from "@/hooks/use-unsaved-work"
import { useWriteMutation } from "@/hooks/use-write-mutation"
import { rangeReadsOf } from "@/lib/appointment-range"
import { formatDay, todayIn } from "@/lib/calendar-date"
import { shownWarning } from "@/lib/competence-warnings"
import { useVehicleAware } from "@/lib/feature-switches"
import { formatLocalTime } from "@/lib/local-time"
import { authRefusalTitle, failureStatus, fieldErrors, parseProblem, problemSlug } from "@/lib/problem-details"
import { cachedCapabilities } from "@/lib/session"
import { cn } from "@/lib/utils"
import { hvLevelOf } from "@/lib/vehicle-aware"

import { timeRange } from "../lib/appointment-text"
import type { BoardAppointment } from "../lib/schedule"
import { canCancel, statusMeta } from "../lib/status"
import { AllocationExplanationView } from "./allocation-explanation"
import { PlateChip } from "./appointment-block"
import { StatusBadge } from "./status-badge"

const REASON_LIMIT = 500

/** Where appointment details are presented: docked inspector (>=1280px), right sheet, or bottom sheet on mobile. */
export type DetailsPresentation = "inspector" | "right" | "bottom"

export interface AppointmentDetailsProps {
  /** The appointment as the board shows it (masked for a visitor). */
  appointment: BoardAppointment
  /** Whether the details are on screen: the full record is read only then. */
  open: boolean
  presentation: DetailsPresentation
  dealershipId: string
  /** The board's date (its schedule query is refreshed after a change). */
  date: string
  timeZone: string
  titleRef: RefObject<HTMLHeadingElement | null>
  reasonRef: RefObject<HTMLTextAreaElement | null>
  /** Whether the cancellation confirmation starts open. */
  confirming?: boolean
  /** The inspector's close button; the sheet draws its own. */
  onClose?: () => void
  /** Called once the appointment is cancelled. */
  onDone: () => void
}

/**
 * Appointment details shared by the docked inspector and the sheet, with role-gated full record loading and cancellation.
 */
export function AppointmentDetails({
  appointment,
  open,
  presentation,
  dealershipId,
  date,
  timeZone,
  titleRef,
  reasonRef,
  confirming = false,
  onClose,
  onDone,
}: AppointmentDetailsProps) {
  const queryClient = useQueryClient()
  const current = useCurrentUser()
  const detailsAccess = detailsAccessOf(current)
  const writeAccess = writeAccessOf(current)
  const path = { appointmentId: appointment.id }
  const detailsOptions = getAppointmentOptions({ path })
  // Check cached capabilities on each read so session transitions never send unauthorized requests.
  const details = useQuery({
    ...detailsOptions,
    enabled: () => open && cachedCapabilities(queryClient).canViewDetails,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const recordLoading = detailsAccess === "checking" || (detailsAccess === "allowed" && details.isPending)
  const detailsFailure = useQueryFailure(details, detailsOptions.queryKey)
  const record: AppointmentResponse | undefined = details.data
  const status = record?.status ?? appointment.status
  const vehicleAware = useVehicleAware()
  const allocation = vehicleAware ? record?.allocation : undefined
  const catalogue = useQuery({ ...getServiceTypesOptions({ path: { dealershipId } }), enabled: Boolean(allocation) })
  const service = catalogue.data?.find((candidate) => candidate.id === appointment.serviceType.id)
  const day = appointment.startLocal.slice(0, 10)
  const warning = shownWarning(record ? record.competenceWarning : appointment.competenceWarning, current.canViewDetails)
  const roster = useQuery({
    ...getWorkshopScheduleOptions({ path: { dealershipId }, query: { date: day } }),
    enabled: (allocation?.reasons.length ?? 0) > 0,
  })
  const hvNeeded = allocation ? hvLevelOf(allocation.minimumHvLevel) : null
  const unmasked = detailsAccess === "allowed"
  const bodyRef = useRef<HTMLDivElement>(null)

  const refreshBoard = () => {
    void queryClient.invalidateQueries({ queryKey: getWorkshopScheduleQueryKey({ path: { dealershipId }, query: { date } }) })
    // Every availability read for that day (the KPI strip's next free slot): a partial key matches any service.
    void queryClient.invalidateQueries({
      queryKey: getAvailabilityQueryKey({ path: { dealershipId }, query: { date } as GetAvailabilityData["query"] }),
    })
    // Every range read of the dealership (the Overview and the Calendar), whatever its dates.
    void queryClient.invalidateQueries({ queryKey: rangeReadsOf(dealershipId) })
  }

  const { refs: cancellationRefs, ...cancellation } = useCancellation({
    access: writeAccess,
    appointment,
    status,
    timeZone,
    reasonRef,
    bodyRef,
    confirming,
    onCancelled: (cancelled) => {
      queryClient.setQueryData(getAppointmentQueryKey({ path }), cancelled)
      refreshBoard()
      onDone()
    },
    onConflict: () => {
      refreshBoard()
      void queryClient.invalidateQueries({ queryKey: getAppointmentQueryKey({ path }) })
    },
  })

  return (
    <>
      {presentation === "bottom" && <div aria-hidden="true" className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/40" />}
      <DetailsHeader
        appointment={appointment}
        status={status}
        timeZone={timeZone}
        presentation={presentation}
        titleRef={titleRef}
        onClose={onClose}
      />

      {/* The one scrolling part, between the pinned header and the pinned buttons: the cards, then the cancellation's words. */}
      <div ref={bodyRef} data-slot="details-body" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex min-h-full flex-col gap-3 p-4">
          <DetailsCard title="Job" icon={ClipboardList}>
            {warning && (
              <CompetenceWarningNotice
                warning={warning}
                technician={appointment.technician.name}
                bay={appointment.bay.name}
                day={formatDay(day, "long")}
                className="mb-3"
              />
            )}
            <Rows>
              <Row term="Bay">{appointment.bay.name}</Row>
              <Row term="Technician">
                <span className="flex min-w-0 items-center gap-2">
                  <InitialsAvatar name={appointment.technician.name} size="sm" />
                  <span className="truncate">{appointment.technician.name}</span>
                </span>
              </Row>
              <Row term="Duration">
                <span className="tabular-nums">{`${appointment.serviceType.durationMinutes} min`}</span>
              </Row>
              {hvNeeded !== null && (
                <Row term="HV needed">
                  <HvLevelBadge level={hvNeeded} named />
                </Row>
              )}
            </Rows>
            {allocation && (
              <Collapsible className="mt-3 border-t pt-2">
                <CollapsibleTrigger className="group/why -mx-1.5 flex min-h-9 w-[calc(100%+0.75rem)] cursor-pointer items-center gap-2 rounded-lg px-1.5 text-left text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11">
                  <Route aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1">Why this allocation</span>
                  <ChevronDown
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-data-panel-open/why:rotate-180"
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <AllocationExplanationView
                    appointment={record!}
                    allocation={allocation}
                    service={service}
                    roster={roster.data}
                    showProfile
                    framed={false}
                  />
                </CollapsibleContent>
              </Collapsible>
            )}
          </DetailsCard>

          <DetailsCard title="Customer" icon={UserRound}>
            <Rows>
              <Row term="Name">{appointment.customerName}</Row>
              {(recordLoading || record) && (
                <>
                  <Row term="Email">
                    <Pending loading={recordLoading}>
                      {record && (
                        <Copyable value={record.customer.email} label="Copy email" copiedLabel="Email copied">
                          <a className={cn(contactLink, "break-all")} href={`mailto:${record.customer.email}`}>
                            {record.customer.email}
                          </a>
                        </Copyable>
                      )}
                    </Pending>
                  </Row>
                  <Row term="Phone">
                    <Pending loading={recordLoading}>
                      {record && (
                        <Copyable value={record.customer.phone} label="Copy phone number" copiedLabel="Phone number copied">
                          <a className={cn(contactLink, "tabular-nums")} href={`tel:${record.customer.phone.replaceAll(" ", "")}`}>
                            {record.customer.phone}
                          </a>
                        </Copyable>
                      )}
                    </Pending>
                  </Row>
                </>
              )}
            </Rows>
          </DetailsCard>

          <DetailsCard title="Vehicle" icon={CarFront}>
            <div className="mb-3 flex items-center gap-3">
              <img
                src={vehiclePlaceholder}
                alt=""
                width={960}
                height={640}
                draggable={false}
                className="pointer-events-none h-auto w-24 shrink-0 select-none"
              />
              <div className="flex min-w-0 flex-col items-start gap-1.5">
                <Pending loading={recordLoading}>
                  {record && <span className="font-heading font-semibold text-pretty">{`${record.vehicle.make} ${record.vehicle.model}`}</span>}
                </Pending>
                <PlateChip registration={appointment.registration} />
              </div>
            </div>
            <Rows>
              <Row term="VIN">
                {unmasked ? (
                  <Copyable value={appointment.vin} label="Copy VIN" copiedLabel="VIN copied">
                    <span className="font-mono text-xs tracking-wide break-all">{appointment.vin}</span>
                  </Copyable>
                ) : (
                  <span className="font-mono text-xs tracking-wide break-all">{appointment.vin}</span>
                )}
              </Row>
            </Rows>
          </DetailsCard>

          {record?.notes && (
            <DetailsCard title="Notes" icon={StickyNote}>
              <p className="text-sm whitespace-pre-line text-pretty">{record.notes}</p>
            </DetailsCard>
          )}
          {record?.cancellationReason && (
            <DetailsCard title="Cancelled because" icon={Ban}>
              <p className="text-sm whitespace-pre-line text-pretty">{record.cancellationReason}</p>
            </DetailsCard>
          )}

          <RecordAccess access={detailsAccess} />
          {detailsFailure !== null && (
            <ProblemAlert
              title="Couldn’t load the full record"
              error={detailsFailure}
              onRetry={() => void details.refetch()}
              retrying={details.isFetching}
            />
          )}

          <dl className="mt-auto grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-3.25 pt-1 text-xs text-muted-foreground">
            {record && (
              <>
                <dt>Booked</dt>
                <dd className="tabular-nums">{`${formatDay(todayIn(timeZone, new Date(record.createdAtUtc)), "short")}, ${formatLocalTime(record.createdAtUtc, timeZone)}`}</dd>
              </>
            )}
            <dt>Reference</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <code className="min-w-0 truncate font-mono" title={appointment.id}>
                {appointment.id}
              </code>
              <CopyButton value={appointment.id} label="Copy appointment reference" copiedLabel="Reference copied" />
            </dd>
          </dl>

          <CancelPrompt
            cancellation={cancellation}
            appointment={appointment}
            timeZone={timeZone}
            reasonRef={reasonRef}
            confirmRef={cancellationRefs.confirm}
            fieldRef={cancellationRefs.field}
            problemRef={cancellationRefs.problem}
          />
        </div>
      </div>

      <CancelActions cancellation={cancellation} startRef={cancellationRefs.start} />
    </>
  )
}

interface DetailsHeaderProps {
  appointment: BoardAppointment
  status: BoardAppointment["status"]
  timeZone: string
  presentation: DetailsPresentation
  titleRef: RefObject<HTMLHeadingElement | null>
  onClose?: () => void
}

function DetailsHeader({ appointment, status, timeZone, presentation, titleRef, onClose }: DetailsHeaderProps) {
  const { icon: StatusIcon, classes } = statusMeta[status]
  const day = appointment.startLocal.slice(0, 10)
  const when = (
    <>
      <span className="whitespace-nowrap">{`${formatDay(day, "long")},`}</span>{" "}
      <span className="whitespace-nowrap">{`${timeRange(appointment, timeZone)} (${timeZone})`}</span>
    </>
  )
  const titleClass = "pr-10 font-heading text-lg leading-snug font-semibold text-balance text-foreground outline-none"
  const inspector = presentation === "inspector"

  return (
    <div data-slot="details-header" className="relative flex shrink-0 items-start gap-3 border-b p-4">
      <span aria-hidden="true" className={cn("inline-flex size-9 shrink-0 items-center justify-center", classes.tile)}>
        <StatusIcon className="size-5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {inspector ? (
          <h2 ref={titleRef} tabIndex={-1} className={titleClass}>
            {appointment.serviceType.name}
          </h2>
        ) : (
          <SheetTitle ref={titleRef} tabIndex={-1} className={titleClass}>
            {appointment.serviceType.name}
          </SheetTitle>
        )}
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted-foreground tabular-nums",
            presentation === "right" && "pr-10"
          )}
        >
          {inspector ? <p className="contents">{when}</p> : <SheetDescription className="contents">{when}</SheetDescription>}
          <StatusBadge status={status} />
        </div>
      </div>
      {inspector && onClose && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Close"
                onClick={onClose}
                className="absolute top-3 right-3 cursor-pointer text-muted-foreground hover:text-foreground"
              />
            }
          >
            <XIcon aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

/** Section card with an icon and heading inside the details panel. */
function DetailsCard({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section data-slot="details-card" className="shrink-0 rounded-xl border border-border p-3 text-sm">
      <h3 className="mb-2.5 flex items-center gap-2 font-heading text-sm font-semibold">
        <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        {title}
      </h3>
      {children}
    </section>
  )
}

function Rows({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5">{children}</dl>
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

function Copyable({ value, label, copiedLabel, children }: { value: string; label: string; copiedLabel: string; children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1">{children}</span>
      <CopyButton value={value} label={label} copiedLabel={copiedLabel} />
    </span>
  )
}

/** Renders a sign-in prompt or missing-role notice when full details are restricted. */
function RecordAccess({ access }: { access: DetailsAccess }) {
  const reasonId = useId()
  if (access === "sign-in") {
    return (
      <SignInPanel title="Sign in to see the whole booking" className="shrink-0">
        <p>Contact details, the vehicle and cancelling need a workshop account. Until then, names, VINs and plates are masked.</p>
      </SignInPanel>
    )
  }
  if (access === "no-role") {
    return (
      <WriteReason
        id={reasonId}
        className="shrink-0"
        reason="Your account has no workshop role yet, so customer details stay masked. The workshop administrator assigns roles."
      />
    )
  }
  return null
}

const contactLink =
  "w-fit rounded-sm text-signal underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center"

function Pending({ loading, children }: { loading: boolean; children: ReactNode }) {
  return loading ? <Skeleton className="h-4 w-40 max-w-full" /> : children
}

const cancelBookingClasses =
  "cursor-pointer border-destructive bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive dark:bg-transparent dark:hover:bg-destructive/10 max-md:h-11"

type CancelVariables = Parameters<NonNullable<ReturnType<typeof cancelAppointmentMutation>["mutationFn"]>>[0]

type CancelOffer = "none" | "not-cancellable" | "unavailable" | "start" | "confirm"

interface CancellationOptions {
  access: WriteAccess
  appointment: BoardAppointment
  status: BoardAppointment["status"]
  timeZone: string
  reasonRef: RefObject<HTMLTextAreaElement | null>
  bodyRef: RefObject<HTMLDivElement | null>
  confirming: boolean
  onCancelled: (cancelled: AppointmentResponse) => void
  onConflict: () => void
}

type Cancellation = Omit<ReturnType<typeof useCancellation>, "refs">
type CancellationRefs = ReturnType<typeof useCancellation>["refs"]

/** Manages cancellation state, confirmation focus/scroll behavior, and mutation submission. */
function useCancellation({ access, appointment, status, timeZone, reasonRef, bodyRef, confirming, onCancelled, onConflict }: CancellationOptions) {
  const ids = { reason: useId(), error: useId(), count: useId(), denied: useId(), prompt: useId(), form: useId() }
  const [open, setOpen] = useState(confirming)
  const [reason, setReason] = useState("")
  useUnsavedWork(reason.trim() !== "")
  const [missingReason, setMissingReason] = useState(false)
  const startRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLFormElement>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const problemRef = useRef<HTMLDivElement>(null)
  const next = useRef<{ focus: "reason" | "start" | null; reveal: boolean }>({ focus: null, reveal: confirming })
  const generated = cancelAppointmentMutation()
  const cancel = useWriteMutation({
    mutationFn: (variables: CancelVariables, write, context) => generated.mutationFn!({ ...variables, fetch: write.fetch() }, context),
    onSuccess: (cancelled) => {
      toast.add({
        type: "success",
        title: "Appointment cancelled",
        description: `${appointment.serviceType.name} at ${formatLocalTime(appointment.startUtc, timeZone)} is cancelled. ${appointment.bay.name} and ${appointment.technician.name} are free again.`,
      })
      onCancelled(cancelled)
    },
    onError: (error) => {
      const slug = parseProblem(error) ? problemSlug(parseProblem(error)!) : ""
      if (slug === "invalid-state-transition" || slug === "concurrency-conflict") onConflict()
    },
  })

  const problem = parseProblem(cancel.error)
  const serverReasonError = problem && problemSlug(problem) === "validation-error" ? fieldErrors(problem, { reason: "Reason" }).reason : undefined
  const reasonError = missingReason ? "Say why the appointment is cancelled." : serverReasonError
  const showProblem = cancel.isError && !serverReasonError
  const offer: CancelOffer = !canCancel(status)
    ? "not-cancellable"
    : access.state === "sign-in"
      ? "none"
      : access.state !== "allowed"
        ? "unavailable"
        : open
          ? "confirm"
          : "start"

  useLayoutEffect(() => {
    const { focus, reveal } = next.current
    next.current = { focus: null, reveal: false }
    if (focus === "reason") reasonRef.current?.focus({ preventScroll: true })
    else if (focus === "start") startRef.current?.focus()
    if (reveal) revealIn(bodyRef.current, confirmSpans(confirmRef.current, fieldRef.current, null), focus === "reason")
  }, [open, reasonRef, bodyRef])

  useEffect(() => {
    if (reasonError || showProblem) {
      revealIn(bodyRef.current, confirmSpans(confirmRef.current, fieldRef.current, showProblem ? problemRef.current : null), true)
    }
  }, [reasonError, showProblem, bodyRef])

  useEffect(() => {
    const body = bodyRef.current
    const content = body?.firstElementChild
    if (offer !== "confirm" || !body || !content || typeof ResizeObserver === "undefined") return
    const topOf = () => (confirmRef.current ? confirmRef.current.getBoundingClientRect().top - content.getBoundingClientRect().top : 0)
    let top = topOf()
    let room = body.clientHeight
    const observer = new ResizeObserver(() => {
      const changed = topOf() !== top || body.clientHeight !== room
      top = topOf()
      room = body.clientHeight
      const confirm = confirmRef.current
      const active = document.activeElement as HTMLButtonElement | null
      if (changed && confirm && active?.form === confirm) {
        revealIn(body, confirmSpans(confirm, fieldRef.current, showProblem ? problemRef.current : null), false)
      }
    })
    observer.observe(content)
    observer.observe(body)
    return () => observer.disconnect()
  }, [offer, showProblem, bodyRef])

  function start() {
    next.current = { focus: "reason", reveal: true }
    setOpen(true)
  }

  function keep() {
    setOpen(false)
    setReason("")
    setMissingReason(false)
    cancel.reset()
    next.current = { focus: "start", reveal: false }
  }

  function changeReason(value: string) {
    setReason(value)
    if (missingReason && value.trim()) setMissingReason(false)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    // The identity in the cache decides, not the last render: `/me` may have changed since, to nobody or to another account.
    const send = cancel.begin()
    if (!send) return
    const trimmed = reason.trim()
    if (!trimmed) {
      setMissingReason(true)
      reasonRef.current?.focus({ preventScroll: true })
      return
    }
    setMissingReason(false)
    send({ path: { appointmentId: appointment.id }, body: { reason: trimmed } })
  }

  return {
    access,
    status,
    offer,
    ids,
    reason,
    reasonError,
    showProblem,
    problem,
    cancel,
    start,
    keep,
    changeReason,
    submit,
    /** For the elements they name, apart from the state: the prompt's form, field and refusal, and *Cancel booking…*. */
    refs: { start: startRef, confirm: confirmRef, field: fieldRef, problem: problemRef },
  }
}

/** How far a revealed part keeps from the scrolling part's edges, room permitting: the cards' own padding (`p-4`). */
const REVEAL_MARGIN = 16

type Span = HTMLElement | null | [HTMLElement | null, HTMLElement | null]

/**
 * What of the confirm to keep in view, the most first: all of it; else its prompt (its title and what it frees) down to
 * the reason, or, with a refusal, the reason down to the refusal; else the reason, or the refusal, alone. With no confirm
 * open, the refusal alone.
 */
function confirmSpans(confirm: HTMLElement | null, field: HTMLElement | null, problem: HTMLElement | null): Span[] {
  const prompt = confirm?.firstElementChild instanceof HTMLElement ? confirm.firstElementChild : null
  return problem ? [confirm, [field, problem], problem] : [confirm, [prompt, field], field]
}

/**
 * Scrolls the details' scrolling part, and only it (`scrollIntoView` would scroll the page too), the least distance that
 * shows the first of `spans` that fits (an element, or the stretch from one element's top to another's foot), with a margin
 * where there is room; when none fits, the top of the last. Smoothly unless reduced motion is asked for, and not at all
 * when it is already in view.
 */
function revealIn(body: HTMLElement | null, spans: Span[], smooth: boolean) {
  if (!body) return
  const room = body.clientHeight
  const offset = body.getBoundingClientRect().top - body.scrollTop
  const stretches = spans.flatMap((span) => {
    const [from, to] = Array.isArray(span) ? span : [span, span]
    return from && to ? [{ top: from.getBoundingClientRect().top - offset, bottom: to.getBoundingClientRect().bottom - offset }] : []
  })
  const stretch = stretches.find(({ top, bottom }) => bottom - top <= room) ?? stretches.at(-1)
  if (!stretch) return
  const margin = Math.max(0, Math.min(REVEAL_MARGIN, (room - (stretch.bottom - stretch.top)) / 2))
  const lowest = stretch.bottom + margin - room
  const highest = stretch.top - margin
  const wanted = lowest <= highest ? Math.min(Math.max(body.scrollTop, lowest), highest) : highest
  const scrollTop = Math.round(Math.max(0, Math.min(wanted, body.scrollHeight - room)))
  if (scrollTop === Math.round(body.scrollTop)) return
  const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  if (typeof body.scrollTo === "function") body.scrollTo({ top: scrollTop, behavior: smooth && !reduced ? "smooth" : "instant" })
  else body.scrollTop = scrollTop
}

/**
 * The cancellation's words, at the foot of the scrolling cards, right above its buttons: the confirm (a form named by its
 * prompt, what it frees, the reason with its `n/500` counter beside its label, the error under it, and a refusal), or why
 * cancelling is unavailable (the status, or the role's reason, which names *Cancel booking…*). A refusal that leaves no
 * confirm open (a conflict that changed the status) shows here too.
 */
function CancelPrompt({
  cancellation: c,
  appointment,
  timeZone,
  reasonRef,
  confirmRef,
  fieldRef,
  problemRef,
}: {
  cancellation: Cancellation
  appointment: BoardAppointment
  timeZone: string
  reasonRef: RefObject<HTMLTextAreaElement | null>
  confirmRef: CancellationRefs["confirm"]
  fieldRef: CancellationRefs["field"]
  problemRef: CancellationRefs["problem"]
}) {
  const refusedStatus = failureStatus(c.cancel.error)
  const alert = c.showProblem && (
    <div ref={problemRef} className="shrink-0">
      <ProblemAlert
        title={
          refusedStatus === 401 || refusedStatus === 403
            ? authRefusalTitle(refusedStatus, "cancel the appointment")
            : (c.problem?.title ?? "Couldn’t cancel the appointment")
        }
        error={c.cancel.error}
        tone={c.problem?.status === 409 || refusedStatus === 401 || refusedStatus === 403 ? "warning" : "error"}
      />
    </div>
  )

  if (c.offer !== "confirm") {
    return (
      <>
        {alert}
        {c.offer === "not-cancellable" && (
          <p className="shrink-0 text-sm text-muted-foreground">
            {c.status === "Cancelled" ? "This appointment is cancelled." : "Only a confirmed or checked-in appointment can be cancelled."}
          </p>
        )}
        {c.offer === "unavailable" && c.access.state === "denied" && <WriteReason id={c.ids.denied} reason={c.access.reason} className="shrink-0" />}
      </>
    )
  }

  return (
    <form
      ref={confirmRef}
      id={c.ids.form}
      noValidate
      aria-labelledby={c.ids.prompt}
      onSubmit={c.submit}
      // Set apart from the reference line above by space alone: a rule here would double the header's when it sits under it.
      className="mt-2 flex shrink-0 flex-col gap-3"
    >
      <div className="flex flex-col gap-0.5">
        <p id={c.ids.prompt} className="font-heading text-sm font-semibold">
          Cancel this booking?
        </p>
        <p className="text-sm text-pretty text-muted-foreground">
          {`${appointment.bay.name} and ${appointment.technician.name} become free at ${formatLocalTime(appointment.startUtc, timeZone)}.`}
        </p>
      </div>
      <Field ref={fieldRef} data-invalid={Boolean(c.reasonError) || undefined} className="gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <FieldLabel htmlFor={c.ids.reason}>Reason</FieldLabel>
          <span id={c.ids.count} className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {`${c.reason.length}/${REASON_LIMIT}`}
            <span className="sr-only"> characters</span>
          </span>
        </div>
        <Textarea
          ref={reasonRef}
          id={c.ids.reason}
          value={c.reason}
          maxLength={REASON_LIMIT}
          rows={2}
          disabled={c.cancel.isPending}
          placeholder="For example: the customer rang to rearrange"
          aria-invalid={Boolean(c.reasonError) || undefined}
          aria-describedby={`${c.reasonError ? `${c.ids.error} ` : ""}${c.ids.count}`}
          onChange={(event) => c.changeReason(event.target.value)}
          className="max-h-40 min-h-14 bg-background"
        />
        <FieldError id={c.ids.error}>{c.reasonError}</FieldError>
      </Field>
      {alert}
    </form>
  )
}

/**
 * The action row, pinned under the scrolling cards and holding only buttons: *Cancel booking…* (unavailable for a role
 * that may not cancel, named by the reason above it), or the confirm's *Keep booking* and *Cancel appointment*, which
 * submits the confirm's form from here. None for a visitor or a status that cannot be cancelled.
 */
function CancelActions({ cancellation: c, startRef }: { cancellation: Cancellation; startRef: CancellationRefs["start"] }) {
  if (c.offer === "none" || c.offer === "not-cancellable") return null
  return (
    <div
      data-slot="details-actions"
      className={cn(
        "flex shrink-0 gap-2 border-t bg-muted/30 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        c.offer === "confirm" ? "flex-col-reverse sm:flex-row sm:justify-end" : "flex-col sm:items-end"
      )}
    >
      {c.offer === "unavailable" ? (
        <Button
          type="button"
          variant="outline"
          disabled
          focusableWhenDisabled
          aria-describedby={c.access.state === "denied" ? c.ids.denied : undefined}
          className={cancelBookingClasses}
        >
          Cancel booking…
        </Button>
      ) : c.offer === "start" ? (
        <Button ref={startRef} type="button" variant="outline" onClick={c.start} className={cancelBookingClasses}>
          Cancel booking…
        </Button>
      ) : (
        <>
          {/* Of the confirm's form too (`form`), though it submits nothing: focus here is focus in the confirm. */}
          <Button
            type="button"
            form={c.ids.form}
            variant="outline"
            onClick={c.keep}
            disabled={c.cancel.isPending}
            className="cursor-pointer max-md:h-11"
          >
            Keep booking
          </Button>
          <Button
            type="submit"
            form={c.ids.form}
            variant="destructive"
            disabled={c.cancel.isPending}
            // Focus stays on it while it cancels, and on it after a failure.
            focusableWhenDisabled
            className="cursor-pointer max-md:h-11"
          >
            {c.cancel.isPending && <LoaderCircle aria-hidden="true" className="animate-spin" />}
            {c.cancel.isPending ? "Cancelling…" : "Cancel appointment"}
          </Button>
        </>
      )}
    </div>
  )
}
