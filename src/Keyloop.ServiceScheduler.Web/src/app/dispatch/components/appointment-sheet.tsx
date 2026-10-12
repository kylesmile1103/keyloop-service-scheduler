import { useQuery, useQueryClient } from "@tanstack/react-query"
import { LoaderCircle } from "lucide-react"
import { type FormEvent, type ReactNode, type RefObject, useId, useRef, useState } from "react"

import {
  cancelAppointmentMutation,
  getAppointmentOptions,
  getAppointmentQueryKey,
  getAvailabilityQueryKey,
  getWorkshopScheduleQueryKey,
} from "@/api/@tanstack/react-query.gen"
import type { AppointmentResponse, GetAvailabilityData } from "@/api/types.gen"
import vehiclePlaceholder from "@/assets/illustrations/vehicle-placeholder.webp"
import { SignInPanel } from "@/components/auth/sign-in-prompt"
import { WriteReason } from "@/components/auth/write-reason"
import { CopyButton } from "@/components/copy-button"
import { InitialsAvatar } from "@/components/initials-avatar"
import { ProblemAlert } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { type DetailsAccess, detailsAccessOf, useCurrentUser, type WriteAccess, writeAccessOf } from "@/hooks/use-current-user"
import { useQueryFailure } from "@/hooks/use-query-failure"
import { useWriteMutation } from "@/hooks/use-write-mutation"
import { rangeReadsOf } from "@/lib/appointment-range"
import { formatDay, todayIn } from "@/lib/calendar-date"
import { formatLocalTime } from "@/lib/local-time"
import { cachedCapabilities } from "@/lib/session"
import { authRefusalTitle, failureStatus, fieldErrors, parseProblem, problemSlug } from "@/lib/problem-details"
import { cn } from "@/lib/utils"

import { timeRange } from "../lib/appointment-text"
import type { BoardAppointment } from "../lib/schedule"
import { canCancel, statusMeta } from "../lib/status"
import { PlateChip } from "./appointment-block"
import { StatusBadge } from "./status-badge"

const REASON_LIMIT = 500

interface AppointmentSheetProps {
  /** The appointment as the board shows it; kept while the sheet animates closed. */
  appointment: BoardAppointment | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Side sheet on wide screens, bottom sheet on phones. */
  side: "right" | "bottom"
  dealershipId: string
  /** The board's date (its schedule query is refreshed after a change). */
  date: string
  timeZone: string
  /** Where focus goes when the sheet closes: the block that opened it, or the board when the block is gone. */
  returnFocus: () => HTMLElement | null
  /** Called once the appointment is cancelled, before the sheet closes (its block is about to leave the board). */
  onCancelled?: () => void
  /**
   * Where focus lands when the sheet opens: its title (the details), or the cancellation's reason field when the sheet was
   * opened to cancel (the appointments list's Cancel action). An appointment that cannot be cancelled opens on its title.
   */
  initialFocus?: "title" | "reason"
}

/**
 * An appointment's details, from the board's snapshot at once and the whole record (contact details, vehicle, notes) as
 * soon as `GET /appointments/{id}` answers, with the cancellation form for a confirmed or checked-in appointment. A refused
 * cancellation shows the API's problem and trace id; a conflict re-reads the board, since someone else changed it.
 *
 * What the sheet asks for follows the signed-in role (UI_DESIGN 11.20): the record is read for any role; a visitor who is
 * not signed in sees the board's masked snapshot and a sign-in panel in its place (no request, so no 401); an account
 * without a role is told why the details stay masked. Cancelling is for an Admin or Service advisor; a Viewer sees the
 * action unavailable with the reason.
 */
export function AppointmentSheet({
  appointment,
  open,
  onOpenChange,
  side,
  dealershipId,
  date,
  timeZone,
  returnFocus,
  onCancelled,
  initialFocus = "title",
}: AppointmentSheetProps) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  return (
    <Sheet open={open && appointment !== null} onOpenChange={onOpenChange}>
      <SheetContent
        ref={popupRef}
        side={side}
        initialFocus={() => (initialFocus === "reason" ? reasonRef.current : null) ?? titleRef.current ?? true}
        // A dialog opened over the sheet keeps focus when the sheet closes beneath it (the session dialog, after a refusal
        // that also closed the sheet because the identity changed). Otherwise focus goes back where the sheet came from, or,
        // when that is gone (the view reading its data again after the identity changed), to the page's content rather
        // than wherever the browser would fall back to.
        finalFocus={() => {
          if (focusInOtherDialog(popupRef.current)) return false
          const target = returnFocus()
          return target?.isConnected ? target : (document.getElementById("content") ?? true)
        }}
        className={cn(
          "gap-0 p-0 *:data-[slot=sheet-close]:pointer-coarse:size-11",
          side === "right" && "w-full"
        )}
      >
        {appointment && (
          <SheetBody
            key={appointment.id}
            appointment={appointment}
            open={open}
            side={side}
            dealershipId={dealershipId}
            date={date}
            timeZone={timeZone}
            titleRef={titleRef}
            reasonRef={reasonRef}
            onDone={() => {
              onCancelled?.()
              onOpenChange(false)
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

/** Whether focus is in a dialog other than `popup`, which then keeps it. */
function focusInOtherDialog(popup: HTMLElement | null): boolean {
  const active = document.activeElement
  return active instanceof HTMLElement && !popup?.contains(active) && active.closest('[role="dialog"]') !== null
}

interface SheetBodyProps {
  appointment: BoardAppointment
  open: boolean
  side: "right" | "bottom"
  dealershipId: string
  date: string
  timeZone: string
  titleRef: RefObject<HTMLHeadingElement | null>
  reasonRef: RefObject<HTMLTextAreaElement | null>
  onDone: () => void
}

function SheetBody({ appointment, open, side, dealershipId, date, timeZone, titleRef, reasonRef, onDone }: SheetBodyProps) {
  const queryClient = useQueryClient()
  const current = useCurrentUser()
  const detailsAccess = detailsAccessOf(current)
  const writeAccess = writeAccessOf(current)
  const path = { appointmentId: appointment.id }
  const detailsOptions = getAppointmentOptions({ path })
  // Decided again whenever the record would be read, from the identity in the cache at that moment: when `/me` changes or
  // fails, the re-read of what the previous caller saw (components/auth/session-watch.tsx) can come before this sheet has
  // rendered for the new state, and a visitor (or nobody known) must never send the read. Not read again when the window
  // regains focus or the network returns: `/me` is read again at that same moment, so the cache would still name the
  // caller from before (a sign-out in another tab); the record is read when the sheet opens, and on Try again.
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
  const { icon: StatusIcon, classes } = statusMeta[status]
  const day = appointment.startLocal.slice(0, 10)

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
      {side === "bottom" && <div aria-hidden="true" className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/40" />}
      <SheetHeader className="gap-3 border-b pr-12">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className={cn("inline-flex size-9 shrink-0 items-center justify-center", classes.tile)}>
            <StatusIcon className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <SheetTitle ref={titleRef} tabIndex={-1} className="font-heading text-lg font-semibold outline-none">
              {appointment.serviceType.name}
            </SheetTitle>
            <SheetDescription className="tabular-nums">
              {`${formatDay(day, "long")}, ${timeRange(appointment, timeZone)} (${timeZone})`}
            </SheetDescription>
          </div>
        </div>
        <StatusBadge status={status} />
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
          <Row term="Duration">{`${appointment.serviceType.durationMinutes} min`}</Row>
          <Row term="Bay">{appointment.bay.name}</Row>
          <Row term="Technician">
            <span className="flex items-center gap-2">
              <InitialsAvatar name={appointment.technician.name} />
              <span>{appointment.technician.name}</span>
            </span>
          </Row>
          <Row term="Customer">
            <span className="flex flex-col gap-0.5">
              <span>{appointment.customerName}</span>
              <Pending loading={recordLoading}>
                {record && (
                  <>
                    <a className={cn(contactLink, "break-all")} href={`mailto:${record.customer.email}`}>
                      {record.customer.email}
                    </a>
                    <a className={cn(contactLink, "tabular-nums")} href={`tel:${record.customer.phone.replaceAll(" ", "")}`}>
                      {record.customer.phone}
                    </a>
                  </>
                )}
              </Pending>
            </span>
          </Row>
          <Row term="Vehicle">
            {/* A generic car, never captioned as the customer's own (UI_DESIGN 12.2). */}
            <span className="flex items-start gap-3">
              <img
                src={vehiclePlaceholder}
                alt=""
                width={960}
                height={640}
                draggable={false}
                className="pointer-events-none h-auto w-20 shrink-0 select-none sm:w-28"
              />
              <span className="flex min-w-0 flex-col items-start gap-1">
                <Pending loading={recordLoading}>
                  {record && <span className="font-heading font-semibold">{`${record.vehicle.make} ${record.vehicle.model}`}</span>}
                </Pending>
                <PlateChip registration={appointment.registration} labelled={false} />
              </span>
            </span>
          </Row>
          <Row term="VIN">
            <span className="font-mono text-xs tracking-wide break-all">{appointment.vin}</span>
          </Row>
          {record?.notes && <Row term="Notes">{record.notes}</Row>}
          {record?.cancellationReason && <Row term="Cancelled because">{record.cancellationReason}</Row>}
          {record && <Row term="Booked">{`${formatDay(todayIn(timeZone, new Date(record.createdAtUtc)), "short")}, ${formatLocalTime(record.createdAtUtc, timeZone)}`}</Row>}
          <Row term="Reference">
            <span className="flex min-w-0 items-center gap-1">
              <code className="truncate font-mono text-xs text-muted-foreground" title={appointment.id}>
                {appointment.id}
              </code>
              <CopyButton value={appointment.id} label="Copy appointment reference" copiedLabel="Reference copied" />
            </span>
          </Row>
        </dl>
        <RecordAccess access={detailsAccess} />
        {detailsFailure !== null && (
          <ProblemAlert
            title="Couldn’t load the full record"
            error={detailsFailure}
            onRetry={() => void details.refetch()}
            retrying={details.isFetching}
            className="mt-4"
          />
        )}
      </div>

      <CancelForm
        access={writeAccess}
        appointment={appointment}
        status={status}
        timeZone={timeZone}
        reasonRef={reasonRef}
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

/**
 * In place of the record when this caller may not read it: a visitor who is not signed in gets the sign-in panel (it also
 * covers cancelling), an account without a role the reason its details stay masked.
 */
function RecordAccess({ access }: { access: DetailsAccess }) {
  const reasonId = useId()
  if (access === "sign-in") {
    return (
      <SignInPanel title="Sign in to see the whole booking" className="mt-4">
        <p>Contact details, the vehicle and cancelling need a workshop account. Until then, names, VINs and plates are masked.</p>
      </SignInPanel>
    )
  }
  if (access === "no-role") {
    return (
      <WriteReason
        id={reasonId}
        className="mt-4"
        reason="Your account has no workshop role yet, so customer details stay masked. The workshop administrator assigns roles."
      />
    )
  }
  return null
}

/** A contact link: underlined, and 44 px tall on a touch screen, where calling or writing is one tap. */
const contactLink =
  "w-fit rounded-sm text-signal underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center"

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

/** A line of skeleton while the whole record loads. */
function Pending({ loading, children }: { loading: boolean; children: ReactNode }) {
  return loading ? <Skeleton className="h-4 w-40" /> : children
}

type CancelVariables = Parameters<NonNullable<ReturnType<typeof cancelAppointmentMutation>["mutationFn"]>>[0]

interface CancelFormProps {
  /** Whether this account may cancel: the form for Admin and Service advisor, the reason for any other role. */
  access: WriteAccess
  appointment: BoardAppointment
  status: BoardAppointment["status"]
  timeZone: string
  reasonRef: RefObject<HTMLTextAreaElement | null>
  onCancelled: (cancelled: AppointmentResponse) => void
  onConflict: () => void
}

function CancelForm({ access, appointment, status, timeZone, reasonRef, onCancelled, onConflict }: CancelFormProps) {
  const reasonId = useId()
  const errorId = useId()
  const countId = useId()
  const deniedId = useId()
  const [reason, setReason] = useState("")
  const [missingReason, setMissingReason] = useState(false)
  const generated = cancelAppointmentMutation()
  // Bound to the account the sheet was drawn for and sent only while the cache names it (checked last as the request
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

  // A visitor who is not signed in has the sign-in panel above, which covers cancelling.
  if (access.state === "sign-in" && canCancel(status)) return null

  return (
    <div className="flex flex-col gap-3 border-t bg-muted/30 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {showProblem && (
        <ProblemAlert
          title={
            refusedStatus === 401 || refusedStatus === 403
              ? authRefusalTitle(refusedStatus, "cancel the appointment")
              : (problem?.title ?? "Couldn’t cancel the appointment")
          }
          error={cancel.error}
          tone={conflict || refusedStatus === 401 || refusedStatus === 403 ? "warning" : "error"}
        />
      )}
      {canCancel(status) && access.state !== "allowed" ? (
        // A role that cannot cancel (or `/me` not answered yet): the action, unavailable, with the reason on screen.
        <div className="flex flex-col gap-3">
          {access.state === "denied" && <WriteReason id={deniedId} reason={access.reason} />}
          <Button
            type="button"
            variant="destructive"
            disabled
            focusableWhenDisabled
            aria-describedby={access.state === "denied" ? deniedId : undefined}
            className="self-stretch sm:self-end max-md:h-11"
          >
            Cancel appointment
          </Button>
        </div>
      ) : canCancel(status) ? (
        <form noValidate onSubmit={submit} className="flex flex-col gap-3">
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
          <Button
            type="submit"
            variant="destructive"
            disabled={cancel.isPending}
            // Focus stays on it while it cancels, and on it after a failure.
            focusableWhenDisabled
            className="self-stretch sm:self-end max-md:h-11"
          >
            {cancel.isPending && <LoaderCircle aria-hidden="true" className="animate-spin" />}
            {cancel.isPending ? "Cancelling…" : "Cancel appointment"}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          {status === "Cancelled" ? "This appointment is cancelled." : "Only a confirmed or checked-in appointment can be cancelled."}
        </p>
      )}
    </div>
  )
}
