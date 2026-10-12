import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
import { CopyButton } from "@/components/copy-button"
import { ProblemAlert } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { fieldErrors, parseProblem, problemSlug } from "@/lib/problem-details"
import { cn } from "@/lib/utils"

import { timeRange } from "../lib/appointment-text"
import { formatDay, todayIn } from "../lib/calendar-date"
import type { BoardAppointment } from "../lib/schedule"
import { canCancel, statusMeta } from "../lib/status"
import { formatLocalTime } from "../lib/time-grid"
import { PlateChip } from "./appointment-block"
import { InitialsAvatar } from "./initials-avatar"
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
}

/**
 * An appointment's details, from the board's snapshot at once and the whole record (contact details, vehicle, notes) as
 * soon as `GET /appointments/{id}` answers, with the cancellation form for a confirmed or checked-in appointment. A refused
 * cancellation shows the API's problem and trace id; a conflict re-reads the board, since someone else changed it.
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
}: AppointmentSheetProps) {
  const titleRef = useRef<HTMLHeadingElement>(null)

  return (
    <Sheet open={open && appointment !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        initialFocus={titleRef}
        finalFocus={() => returnFocus() ?? true}
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

interface SheetBodyProps {
  appointment: BoardAppointment
  open: boolean
  side: "right" | "bottom"
  dealershipId: string
  date: string
  timeZone: string
  titleRef: RefObject<HTMLHeadingElement | null>
  onDone: () => void
}

function SheetBody({ appointment, open, side, dealershipId, date, timeZone, titleRef, onDone }: SheetBodyProps) {
  const queryClient = useQueryClient()
  const path = { appointmentId: appointment.id }
  const details = useQuery({ ...getAppointmentOptions({ path }), enabled: open })
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
              <Pending loading={details.isPending}>
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
            {/* A generic car, never captioned as the customer's own (DESIGN_SYSTEM 12.2). */}
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
                <Pending loading={details.isPending}>
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
        {details.isError && (
          <ProblemAlert
            title="Couldn’t load the full record"
            error={details.error}
            onRetry={() => void details.refetch()}
            retrying={details.isFetching}
            className="mt-4"
          />
        )}
      </div>

      <CancelForm
        appointment={appointment}
        status={status}
        timeZone={timeZone}
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

interface CancelFormProps {
  appointment: BoardAppointment
  status: BoardAppointment["status"]
  timeZone: string
  onCancelled: (cancelled: AppointmentResponse) => void
  onConflict: () => void
}

function CancelForm({ appointment, status, timeZone, onCancelled, onConflict }: CancelFormProps) {
  const reasonId = useId()
  const errorId = useId()
  const countId = useId()
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const [reason, setReason] = useState("")
  const [missingReason, setMissingReason] = useState(false)
  const cancel = useMutation({
    ...cancelAppointmentMutation(),
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
  const conflict = problem?.status === 409
  const showProblem = cancel.isError && !serverReasonError

  function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = reason.trim()
    if (!trimmed) {
      setMissingReason(true)
      reasonRef.current?.focus()
      return
    }
    setMissingReason(false)
    cancel.mutate({ path: { appointmentId: appointment.id }, body: { reason: trimmed } })
  }

  return (
    <div className="flex flex-col gap-3 border-t bg-muted/30 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {showProblem && (
        <ProblemAlert
          title={problem?.title ?? "Couldn’t cancel the appointment"}
          error={cancel.error}
          tone={conflict ? "warning" : "error"}
        />
      )}
      {canCancel(status) ? (
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
