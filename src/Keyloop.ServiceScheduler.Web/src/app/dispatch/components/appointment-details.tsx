import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Ban, CarFront, ChevronDown, ClipboardList, LoaderCircle, type LucideIcon, Route, StickyNote, UserRound, XIcon } from "lucide-react"
import { type FormEvent, type ReactNode, type RefObject, useEffect, useId, useRef, useState } from "react"

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

/**
 * Where an appointment's details show (UI_DESIGN 11.14): docked beside the board from 1280 px (`inspector`), else the sheet,
 * on the right of a wide screen or from the bottom of a phone.
 */
export type DetailsPresentation = "inspector" | "right" | "bottom"

export interface AppointmentDetailsProps {
  /** The appointment as the board shows it (the caller's view: masked for a visitor). */
  appointment: BoardAppointment
  /** Whether the details are on screen: the whole record is read only then. */
  open: boolean
  presentation: DetailsPresentation
  dealershipId: string
  /** The board's date (its schedule query is refreshed after a change). */
  date: string
  timeZone: string
  titleRef: RefObject<HTMLHeadingElement | null>
  reasonRef: RefObject<HTMLTextAreaElement | null>
  /** Opened to cancel (the appointments list's Cancel action): the cancellation's confirm starts open. */
  confirming?: boolean
  /** The inspector's close button; the sheet draws its own. */
  onClose?: () => void
  /** Called once the appointment is cancelled: the details close. */
  onDone: () => void
}

/**
 * An appointment's details, shared by the docked inspector and the sheet: a header (status tile, service, day and time in
 * the dealership's zone, status), then sectioned cards (Job, Customer, Vehicle, Notes) and a quiet reference line, and an
 * action row with *Cancel booking…*, which opens a short confirm with the reason. The board's snapshot shows at once and
 * the whole record (contact details, vehicle, notes) as soon as `GET /appointments/{id}` answers. A refused cancellation
 * shows the API's problem and trace id; a conflict re-reads the board, since someone else changed it.
 *
 * What it asks for follows the signed-in role (UI_DESIGN 11.20): the record is read for any role; a visitor who is not
 * signed in sees the board's masked snapshot and a sign-in panel in its place (no request, so no 401); an account without
 * a role is told why the details stay masked. Cancelling is for an Admin or Service advisor; a Viewer sees the action
 * unavailable with the reason.
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
  // Decided again whenever the record would be read, from the identity in the cache at that moment: when `/me` changes or
  // fails, the re-read of what the previous caller saw (components/auth/session-watch.tsx) can come before these details
  // have rendered for the new state, and a visitor (or nobody known) must never send the read. Not read again when the
  // window regains focus or the network returns: `/me` is read again at that same moment, so the cache would still name
  // the caller from before (a sign-out in another tab); the record is read when the details open, and on Try again.
  const details = useQuery({
    ...detailsOptions,
    enabled: () => open && cachedCapabilities(queryClient).canViewDetails,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  // Skeletons while the record may still come: until `/me` answers, and while a role's read is out.
  const recordLoading = detailsAccess === "checking" || (detailsAccess === "allowed" && details.isPending)
  // Kept while Try again reads the record again, so the alert and its focused button stay until the answer.
  const detailsFailure = useQueryFailure(details, detailsOptions.queryKey)
  const record: AppointmentResponse | undefined = details.data
  const status = record?.status ?? appointment.status
  // Why this technician and bay (ADR-029), with vehicle-aware requirements on: from the role-protected record only, so a
  // visitor never sees it; the service's needs come from the catalogue the board already read (caller-independent).
  const vehicleAware = useVehicleAware()
  const allocation = vehicleAware ? record?.allocation : undefined
  const catalogue = useQuery({ ...getServiceTypesOptions({ path: { dealershipId } }), enabled: Boolean(allocation) })
  const service = catalogue.data?.find((candidate) => candidate.id === appointment.serviceType.id)
  const day = appointment.startLocal.slice(0, 10)
  // Needs review (Task 30b): the record's warning once read, else the board's; only for a workshop role. A cancelled,
  // completed or no-show appointment holds nothing any more, and the API flags none.
  const warning = shownWarning(record ? record.competenceWarning : appointment.competenceWarning, current.canViewDetails)
  // A preference the allocation did not follow is named from the day's bays and technicians, with that technician's HV
  // level (a role's schedule carries it): the appointment's own day, read only when the record says one was not followed.
  // The board's read of that day has the same key, so the board's details find it there; the Overview and the Calendar
  // read it once.
  const roster = useQuery({
    ...getWorkshopScheduleOptions({ path: { dealershipId }, query: { date: day } }),
    enabled: (allocation?.reasons.length ?? 0) > 0,
  })
  const hvNeeded = allocation ? hvLevelOf(allocation.minimumHvLevel) : null
  const unmasked = detailsAccess === "allowed"

  const refreshBoard = () => {
    void queryClient.invalidateQueries({ queryKey: getWorkshopScheduleQueryKey({ path: { dealershipId }, query: { date } }) })
    // Every availability read for that day (the KPI strip's next free slot): a partial key matches any service.
    void queryClient.invalidateQueries({
      queryKey: getAvailabilityQueryKey({ path: { dealershipId }, query: { date } as GetAvailabilityData["query"] }),
    })
    // Every range read of the dealership (the Overview and the Calendar), whatever its dates.
    void queryClient.invalidateQueries({ queryKey: rangeReadsOf(dealershipId) })
  }

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

      <div data-slot="details-body" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4">
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
          {/* A generic car, never captioned as the customer's own (UI_DESIGN 12.2). */}
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

        {/* The quiet footer: when it was booked, and the reference to quote, aligned with the cards' rows. */}
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
      </div>

      <CancelActions
        access={writeAccess}
        appointment={appointment}
        status={status}
        timeZone={timeZone}
        reasonRef={reasonRef}
        confirming={confirming}
        onCancelled={(cancelled) => {
          queryClient.setQueryData(getAppointmentQueryKey({ path }), cancelled)
          refreshBoard()
          onDone()
        }}
        onConflict={() => {
          refreshBoard()
          void queryClient.invalidateQueries({ queryKey: getAppointmentQueryKey({ path }) })
        }}
      />
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

/**
 * The status tile, the service as the heading (the sheet's title, or the inspector's `h2`), the day and time in the
 * dealership's zone, the status, and the inspector's close button (the sheet's own sits in the same corner).
 */
function DetailsHeader({ appointment, status, timeZone, presentation, titleRef, onClose }: DetailsHeaderProps) {
  const { icon: StatusIcon, classes } = statusMeta[status]
  const day = appointment.startLocal.slice(0, 10)
  // Two pieces that each stay whole, so a narrow header breaks after the day, never inside the times.
  const when = (
    <>
      <span className="whitespace-nowrap">{`${formatDay(day, "long")},`}</span>{" "}
      <span className="whitespace-nowrap">{`${timeRange(appointment, timeZone)} (${timeZone})`}</span>
    </>
  )
  const titleClass = "font-heading text-lg leading-snug font-semibold text-balance text-foreground outline-none"
  const inspector = presentation === "inspector"

  return (
    <div data-slot="details-header" className={cn("flex shrink-0 items-start gap-3 border-b p-4", !inspector && "pr-12")}>
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
        {inspector ? (
          <p className="text-sm text-pretty text-muted-foreground tabular-nums">{when}</p>
        ) : (
          <SheetDescription className="text-pretty tabular-nums">{when}</SheetDescription>
        )}
        <StatusBadge status={status} className="mt-1.5" />
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
                className="-mt-1 -mr-1 cursor-pointer text-muted-foreground hover:text-foreground"
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

/** One section of the details: a hairline card (UI_DESIGN 11.14) headed by its icon and an `h3`. */
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

/** A card's label and value rows: one label column in every card, so the values line up down the whole panel. */
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

/** A value with its copy button at the row's end, where every copy button of the panel lines up. */
function Copyable({ value, label, copiedLabel, children }: { value: string; label: string; copiedLabel: string; children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1">{children}</span>
      <CopyButton value={value} label={label} copiedLabel={copiedLabel} />
    </span>
  )
}

/**
 * In place of the record when this caller may not read it: a visitor who is not signed in gets the sign-in panel (it also
 * covers cancelling), an account without a role the reason its details stay masked.
 */
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

/** A contact link: underlined, and 44 px tall on a touch screen, where calling or writing is one tap. */
const contactLink =
  "w-fit rounded-sm text-signal underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center"

/** A line of skeleton while the whole record loads. */
function Pending({ loading, children }: { loading: boolean; children: ReactNode }) {
  return loading ? <Skeleton className="h-4 w-40 max-w-full" /> : children
}

/**
 * *Cancel booking…*: a destructive outline button (UI_DESIGN 11.2), never a red fill at rest. The base `outline` look is
 * replaced in both themes, so the text stays `destructive` on the surface it was audited on (4.4).
 */
const cancelBookingClasses =
  "cursor-pointer border-destructive bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive dark:bg-transparent dark:hover:bg-destructive/10 max-md:h-11"

type CancelVariables = Parameters<NonNullable<ReturnType<typeof cancelAppointmentMutation>["mutationFn"]>>[0]

interface CancelActionsProps {
  /** Whether this account may cancel: the action for Admin and Service advisor, the reason for any other role. */
  access: WriteAccess
  appointment: BoardAppointment
  status: BoardAppointment["status"]
  timeZone: string
  reasonRef: RefObject<HTMLTextAreaElement | null>
  /** The confirm starts open (opened to cancel). */
  confirming: boolean
  onCancelled: (cancelled: AppointmentResponse) => void
  onConflict: () => void
}

/**
 * The action row: *Cancel booking…* opens a short confirm in place (what it frees, the reason with its counter, *Keep
 * booking* and *Cancel appointment*); nothing is sent until *Cancel appointment*. Focus goes to the reason as the confirm
 * opens and back to *Cancel booking…* when it is kept.
 */
function CancelActions({ access, appointment, status, timeZone, reasonRef, confirming, onCancelled, onConflict }: CancelActionsProps) {
  const reasonId = useId()
  const errorId = useId()
  const countId = useId()
  const deniedId = useId()
  const promptId = useId()
  const [open, setOpen] = useState(confirming)
  const [reason, setReason] = useState("")
  const [missingReason, setMissingReason] = useState(false)
  const startRef = useRef<HTMLButtonElement>(null)
  // Where focus goes once the confirm has drawn or gone: the reason as it opens, Cancel booking… once it is kept. Not on
  // the first render: opened to cancel, the sheet itself puts focus on the reason.
  const focusNext = useRef<"reason" | "start" | null>(null)
  const generated = cancelAppointmentMutation()
  // Bound to the account the details were drawn for and sent only while the cache names it (checked last as the request
  // leaves, `write.fetch`), and its answer thrown away if who is signed in changed meanwhile (`useWriteMutation`): a reason
  // typed for one account is never sent as another, and a late answer neither caches the record nor shows a toast for the
  // next caller.
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

  useEffect(() => {
    if (focusNext.current === "reason") reasonRef.current?.focus()
    else if (focusNext.current === "start") startRef.current?.focus()
    focusNext.current = null
  }, [open, reasonRef])

  const problem = parseProblem(cancel.error)
  const refusedStatus = failureStatus(cancel.error)
  const serverReasonError = problem && problemSlug(problem) === "validation-error" ? fieldErrors(problem, { reason: "Reason" }).reason : undefined
  const reasonError = missingReason ? "Say why the appointment is cancelled." : serverReasonError
  const conflict = problem?.status === 409
  const showProblem = cancel.isError && !serverReasonError

  function submit(event: FormEvent) {
    event.preventDefault()
    // The identity in the cache decides, not the last render: `/me` may have changed since, to nobody or to another account.
    const send = cancel.begin()
    if (!send) return
    const trimmed = reason.trim()
    if (!trimmed) {
      setMissingReason(true)
      reasonRef.current?.focus()
      return
    }
    setMissingReason(false)
    send({ path: { appointmentId: appointment.id }, body: { reason: trimmed } })
  }

  function keep() {
    setOpen(false)
    setReason("")
    setMissingReason(false)
    cancel.reset()
    focusNext.current = "start"
  }

  // A visitor who is not signed in has the sign-in panel above, which covers cancelling.
  if (access.state === "sign-in" && canCancel(status)) return null

  const alert = showProblem && (
    <ProblemAlert
      title={
        refusedStatus === 401 || refusedStatus === 403
          ? authRefusalTitle(refusedStatus, "cancel the appointment")
          : (problem?.title ?? "Couldn’t cancel the appointment")
      }
      error={cancel.error}
      tone={conflict || refusedStatus === 401 || refusedStatus === 403 ? "warning" : "error"}
    />
  )

  return (
    <div
      data-slot="details-actions"
      className="flex shrink-0 flex-col gap-3 border-t bg-muted/30 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      {alert}
      {!canCancel(status) ? (
        <p className="text-sm text-muted-foreground">
          {status === "Cancelled" ? "This appointment is cancelled." : "Only a confirmed or checked-in appointment can be cancelled."}
        </p>
      ) : access.state !== "allowed" ? (
        // A role that cannot cancel (or `/me` not answered yet): the action, unavailable, with the reason on screen.
        <div className="flex flex-col gap-3">
          {access.state === "denied" && <WriteReason id={deniedId} reason={access.reason} />}
          <Button
            type="button"
            variant="outline"
            disabled
            focusableWhenDisabled
            aria-describedby={access.state === "denied" ? deniedId : undefined}
            className={cn(cancelBookingClasses, "self-stretch sm:self-end")}
          >
            Cancel booking…
          </Button>
        </div>
      ) : open ? (
        <form noValidate aria-labelledby={promptId} onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <p id={promptId} className="font-heading text-sm font-semibold">
              Cancel this booking?
            </p>
            <p className="text-sm text-pretty text-muted-foreground">
              {`${appointment.bay.name} and ${appointment.technician.name} become free at ${formatLocalTime(appointment.startUtc, timeZone)}.`}
            </p>
          </div>
          <Field data-invalid={Boolean(reasonError) || undefined} className="gap-1.5">
            <FieldLabel htmlFor={reasonId}>Reason</FieldLabel>
            <Textarea
              ref={reasonRef}
              id={reasonId}
              value={reason}
              maxLength={REASON_LIMIT}
              rows={2}
              disabled={cancel.isPending}
              placeholder="For example: the customer rang to rearrange"
              aria-invalid={Boolean(reasonError) || undefined}
              aria-describedby={`${reasonError ? `${errorId} ` : ""}${countId}`}
              onChange={(event) => {
                setReason(event.target.value)
                if (missingReason && event.target.value.trim()) setMissingReason(false)
              }}
              className="max-h-40 min-h-16 bg-background"
            />
            <div className="flex items-start justify-between gap-3">
              <FieldError id={errorId}>{reasonError}</FieldError>
              <span id={countId} className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                {`${reason.length}/${REASON_LIMIT}`}
                <span className="sr-only"> characters</span>
              </span>
            </div>
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={keep} disabled={cancel.isPending} className="cursor-pointer max-md:h-11">
              Keep booking
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={cancel.isPending}
              // Focus stays on it while it cancels, and on it after a failure.
              focusableWhenDisabled
              className="cursor-pointer max-md:h-11"
            >
              {cancel.isPending && <LoaderCircle aria-hidden="true" className="animate-spin" />}
              {cancel.isPending ? "Cancelling…" : "Cancel appointment"}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          ref={startRef}
          type="button"
          variant="outline"
          onClick={() => {
            focusNext.current = "reason"
            setOpen(true)
          }}
          className={cn(cancelBookingClasses, "self-stretch sm:self-end")}
        >
          Cancel booking…
        </Button>
      )}
    </div>
  )
}
