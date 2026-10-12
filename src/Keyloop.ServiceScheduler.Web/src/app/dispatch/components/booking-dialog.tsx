/*
 * Adopted from the shadcn dashboard template (MIT; notice in the README): the dialog, date field and select layout of
 * `vite-version/src/app/calendar/components/event-form.tsx`, and the react-hook-form + zod + `Field` pattern of
 * `vite-version/src/app/users/components/user-form-dialog.tsx`. Adapted to the generated API client, the two-step stepper,
 * slot chips instead of free time inputs, the full-screen sheet on phones and the design system (DESIGN_SYSTEM 11.14).
 */
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarDays, Check, ChevronRight, CircleAlert, LoaderCircle, RotateCw } from "lucide-react"
import { type FormEvent, type ReactNode, type Ref, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { Controller, type FieldPath, useForm, useWatch } from "react-hook-form"
import { labelDayButton } from "react-day-picker"

import {
  bookAppointmentMutation,
  getAvailabilityQueryKey,
  getServiceTypesOptions,
  getWorkshopScheduleQueryKey,
} from "@/api/@tanstack/react-query.gen"
import type {
  AppointmentResponse,
  BookAppointmentRequest,
  DealershipResponse,
  GetAvailabilityData,
  ServiceTypeResponse,
  WorkshopScheduleResponse,
} from "@/api/types.gen"
import { IllustratedState } from "@/components/illustrated-state"
import { ProblemAlert } from "@/components/problem-alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { useCountdown } from "@/hooks/use-countdown"
import { useMutationFailure } from "@/hooks/use-mutation-failure"
import { useQueryFailure } from "@/hooks/use-query-failure"
import {
  describeFailure,
  fieldErrors,
  parseProblem,
  type ProblemDetails,
  problemSlug,
  UnexpectedResponseError,
} from "@/lib/problem-details"
import { withSpan } from "@/lib/telemetry"
import { cn } from "@/lib/utils"

import { bookingTriageStatusQuery, useBookingTriage } from "../hooks/use-booking-triage"
import { localTime } from "../lib/appointment-text"
import { bookingSchema, type BookingForm, type BookingFormInput, stepOneFields, toBookingRequest } from "../lib/booking-schema"
import { formatDay, fromPickerDate, toPickerDate, weekdayOf } from "../lib/calendar-date"
import { featureLabel } from "../lib/features"
import { nextOpenDate, openingHoursOn } from "../lib/opening-hours"
import { AvailabilityChips, SuggestedSlotChips } from "./availability-chips"
import { BookingTriageIntake } from "./booking-triage"
import { CapabilityBadges } from "./capability-badges"

export interface BookingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  dealership: DealershipResponse
  /** The board's schedule: its bays and technicians are the preferred-resource choices. */
  schedule: WorkshopScheduleResponse | undefined
  /**
   * The day the dialog starts on (`yyyy-MM-dd`): the board's day (today when the board shows a past one), moved on to the
   * next day the dealership opens when that day is closed, since a closed day cannot be picked.
   */
  initialDate: string
  today: string
  /** Phones: a full-screen sheet that ends on a success state instead of closing (DESIGN_SYSTEM 11.14). */
  fullScreen: boolean
  /** A booking was made (the board refreshes and highlights it; on wide screens the dialog has closed). */
  onBooked: (appointment: AppointmentResponse) => void
  /** The success state's "View on board" (phones). */
  onViewOnBoard: (appointment: AppointmentResponse) => void
}

/**
 * Book appointment: step 1 picks the service, the day and a free start (slot chips from `GET /availability`), optionally
 * from services suggested for the issue's description when booking intake triage is on (`BookingTriageIntake`); step 2 takes
 * the customer and the vehicle, with an optional preferred bay and technician. A dialog on wide screens, a full-screen
 * sheet on phones. Every attempt of one booking carries the same `Idempotency-Key`, so trying again after a lost answer
 * can never book twice; a conflict offers the API's suggested starts, a refused rule says why, and field errors land on
 * their fields.
 */
export function BookingDialog({ open, onOpenChange, fullScreen, ...flow }: BookingDialogProps) {
  // Whether to offer suggestions, read while the dialog is still closed (see `bookingTriageStatusQuery`).
  useQuery(bookingTriageStatusQuery())
  if (fullScreen) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          // Every override carries the sheet's own `data-[side=bottom]:` variant: tailwind-merge then replaces the bottom sheet's
          // auto height, 85dvh cap and radius (a bare `h-dvh` loses to the variant's `h-auto` on specificity).
          className="gap-0 overflow-clip p-0 data-[side=bottom]:h-dvh data-[side=bottom]:max-h-dvh data-[side=bottom]:rounded-none *:data-[slot=sheet-close]:top-2 *:data-[slot=sheet-close]:right-2"
        >
          <BookingFlow {...flow} layout="sheet" onClose={() => onOpenChange(false)} />
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 shadow-xl sm:max-w-2xl">
        <BookingFlow {...flow} layout="dialog" onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

type Layout = "dialog" | "sheet"
type Step = 1 | 2

interface BookingFlowProps extends Omit<BookingDialogProps, "open" | "onOpenChange" | "fullScreen"> {
  layout: Layout
  onClose: () => void
}

const blank = (date: string): BookingFormInput => ({
  serviceTypeId: "",
  date,
  startUtc: "",
  customer: { name: "", email: "", phone: "" },
  vehicle: { vin: "", registration: "", make: "", model: "" },
  preferredBayId: undefined,
  preferredTechnicianId: undefined,
  notes: "",
})

/**
 * The form paths a `400`'s `errors` can name (camelCase JSON paths, as `fieldErrors` writes them), with the name each field
 * goes by on screen: the API's messages open with the path ("vehicle.vin must be ..."), the form's with the label.
 */
const formLabels = {
  serviceTypeId: "Service",
  startUtc: "Start time",
  "customer.name": "Name",
  "customer.email": "Email",
  "customer.phone": "Phone",
  "vehicle.vin": "VIN",
  "vehicle.registration": "Registration",
  "vehicle.make": "Make",
  "vehicle.model": "Model",
  preferredBayId: "Preferred bay",
  preferredTechnicianId: "Preferred technician",
  notes: "Notes",
} satisfies Partial<Record<FieldPath<BookingFormInput>, string>>

const formPaths = Object.keys(formLabels) as ReadonlyArray<keyof typeof formLabels>

/** Business rules about the start time (§8.7): the fix is another start, back on step 1. */
const timeRules = new Set(["outside-operating-hours", "lead-time-not-met", "beyond-booking-horizon", "slot-not-aligned"])

function BookingFlow({ dealership, schedule, initialDate, today, layout, onBooked, onViewOnBoard, onClose }: BookingFlowProps) {
  const dealershipId = dealership.id
  const timeZone = dealership.timeZoneId
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>(1)
  const [booked, setBooked] = useState<AppointmentResponse | null>(null)
  // One booking intention, one key: every attempt (a retry after a lost answer, a suggested slot after a conflict) sends it,
  // so the API books at most once (§7.5). A new key only after a success, for the next booking.
  const idempotencyKey = useRef(crypto.randomUUID())
  const lastRequest = useRef<BookAppointmentRequest | null>(null)
  const stepHeading = useRef<HTMLHeadingElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const problemRef = useRef<HTMLDivElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)
  const moved = useRef(false)
  const [waiting, startWaiting] = useCountdown()

  const form = useForm<BookingFormInput, unknown, BookingForm>({
    resolver: zodResolver(bookingSchema),
    defaultValues: blank(initialDate),
    mode: "onTouched",
  })
  const [serviceTypeId, date, startUtc, notes = ""] = useWatch({
    control: form.control,
    name: ["serviceTypeId", "date", "startUtc", "notes"],
  })
  const serviceTypesOptions = getServiceTypesOptions({ path: { dealershipId } })
  const serviceTypes = useQuery(serviceTypesOptions)
  // Kept while Try again loads them again, so the alert and its focused button stay in the dialog until the answer.
  const serviceTypesFailure = useQueryFailure(serviceTypes, serviceTypesOptions.queryKey)
  const service = serviceTypes.data?.find((candidate) => candidate.id === serviceTypeId)

  // Booking intake triage (§8.10): optional, above the service. Its state outlives step 1, for when the person comes back.
  const triage = useBookingTriage(dealershipId)
  // What the dialog last copied into Notes from the description: notes that still read exactly that are the copy, not the
  // person's own words, so they can follow the description (or go when the box is unticked); anything else is never touched.
  const [copiedNotes, setCopiedNotes] = useState("")
  // Raised when a suggestion is used, so focus moves on to its free starts once they are on screen.
  const [startFocusRequest, setStartFocusRequest] = useState(0)

  const generated = bookAppointmentMutation()
  const book = useMutation({
    ...generated,
    // The generated mutation, inside a `ui.book_appointment` span whose fetch carries `traceparent` to the API, so one trace
    // runs from the click to PostgreSQL in the Aspire dashboard.
    mutationFn: (variables, context) =>
      withSpan("ui.book_appointment", ({ fetch }) => generated.mutationFn!({ ...variables, fetch }, context), {
        "keyloop.dealership_id": dealershipId,
        "keyloop.service_type_id": variables.body.serviceTypeId,
      }),
    onSuccess: (appointment) => {
      idempotencyKey.current = crypto.randomUUID()
      const day = appointment.startLocal.slice(0, 10)
      void queryClient.invalidateQueries({ queryKey: getWorkshopScheduleQueryKey({ path: { dealershipId }, query: { date: day } }) })
      // Every service's availability that day (the KPI strip's next free slot and the chips): a partial key matches them all.
      void queryClient.invalidateQueries({
        queryKey: getAvailabilityQueryKey({ path: { dealershipId }, query: { date: day } as GetAvailabilityData["query"] }),
      })
      onBooked(appointment)
      if (layout === "sheet") setBooked(appointment)
      else onClose()
    },
    onError: (error) => {
      const problem = parseProblem(error)
      const slug = problem ? problemSlug(problem) : ""
      if (slug === "validation-error" && problem) {
        const errors = fieldErrors(problem, formLabels)
        let onStepOne = false
        for (const path of formPaths) {
          const message = errors[path]
          if (!message) continue
          form.setError(path, { type: "server", message })
          if ((stepOneFields as readonly string[]).includes(path)) onStepOne = true
        }
        if (onStepOne) goTo(1)
        return
      }
      const status = problem?.status ?? (error instanceof UnexpectedResponseError ? error.status : undefined)
      if (status === 429) startWaiting(Math.max(1, Math.ceil(Number(problem?.retryAfterSeconds ?? 1))))
      if (status === undefined || status >= 500) {
        toast.add({
          type: "error",
          title: "Couldn’t book the appointment",
          description: `${status ? `The server answered ${status}. ` : ""}${describeFailure(error).summary} Trying again is safe: it cannot book twice.`,
        })
      }
      if (slug === "slot-unavailable" || slug === "slot-conflict") {
        // Someone took the slot: the chips are stale too.
        void queryClient.invalidateQueries({
          queryKey: getAvailabilityQueryKey({ path: { dealershipId }, query: { date } as GetAvailabilityData["query"] }),
        })
      }
    },
  })

  // The last refusal, kept while this booking is tried again (Try again, a suggested start, Book): the alert and the
  // control that was pressed in it stay, unavailable but focused, until the answer (a mutation that runs again has no error).
  const failure = useMutationFailure(book)

  // The new step's heading takes focus, so keyboard and screen-reader users start at its top (DESIGN_SYSTEM 11.14).
  useEffect(() => {
    if (moved.current) stepHeading.current?.focus()
  }, [step])

  // A refusal comes into view where the user is looking (the step may be scrolled to its last field). When the control that
  // was pressed went with the last one (a suggested start that is now taken too, Try again when the answer is a conflict),
  // focus moves to the new refusal, or to the first field it marked, instead of falling to the dialog. A layout effect: in
  // the same commit as the removal, before the dialog's focus guard puts lost focus on the dialog itself.
  useLayoutEffect(() => {
    if (!failure) return
    problemRef.current?.scrollIntoView?.({ block: "nearest" })
    if (formRef.current?.contains(document.activeElement)) return
    const refusedField = formPaths.find((path) => form.getFieldState(path).error)
    if (alertRef.current) alertRef.current.focus()
    else if (refusedField) form.setFocus(refusedField)
    else stepHeading.current?.focus()
  }, [failure, form])

  function goTo(next: Step) {
    moved.current = true
    setStep(next)
  }

  async function next() {
    if (!(await form.trigger(stepOneFields, { shouldFocus: true }))) return
    copyDescriptionIntoNotes()
    goTo(2)
  }

  /** "Use this" on a suggestion: its service and, when the workshop opens then, the day asked for; a start comes next. */
  function applySuggestion(suggestedServiceTypeId: string, suggestedDate: string | null) {
    form.setValue("serviceTypeId", suggestedServiceTypeId, { shouldValidate: true })
    if (suggestedDate) form.setValue("date", suggestedDate, { shouldValidate: true })
    // A start belongs to one service's availability on one day.
    form.setValue("startUtc", "")
    setStartFocusRequest((request) => request + 1)
  }

  /**
   * Step 2's notes from the description, when the box is ticked: written into empty notes, kept up to date while they are
   * still the copy, taken out again when the box is unticked, and never written over the person's own notes.
   */
  function copyDescriptionIntoNotes() {
    const wanted = triage.enabled && triage.copyToNotes ? triage.description.trim() : ""
    const current = form.getValues("notes") ?? ""
    if (current !== "" && current !== copiedNotes) return
    if (current !== wanted) form.setValue("notes", wanted)
    setCopiedNotes(wanted)
  }

  function back() {
    book.reset()
    goTo(1)
  }

  function submit(event?: FormEvent) {
    void form.handleSubmit(
      (values) => {
        const body = toBookingRequest(values)
        lastRequest.current = body
        book.mutate({ path: { dealershipId }, body, headers: { "Idempotency-Key": idempotencyKey.current } })
      },
      (errors) => {
        if (stepOneFields.some((field) => errors[field])) goTo(1)
        // react-hook-form focuses the first invalid field; on a phone it can sit under the sticky footer.
        requestAnimationFrame(() => (document.activeElement as HTMLElement | null)?.scrollIntoView?.({ block: "center" }))
      }
    )(event)
  }

  /** The same request again, with the same key: safe after a lost answer, and replayed (not re-booked) if it had succeeded. */
  function retry() {
    if (!lastRequest.current || book.isPending) return
    book.mutate({ path: { dealershipId }, body: lastRequest.current, headers: { "Idempotency-Key": idempotencyKey.current } })
  }

  function bookAt(slot: { startUtc: string }) {
    if (book.isPending) return
    form.setValue("startUtc", slot.startUtc, { shouldValidate: true })
    submit()
  }

  function bookAnother() {
    form.reset(blank(date))
    book.reset()
    triage.reset()
    setCopiedNotes("")
    setBooked(null)
    goTo(1)
  }

  const Title = layout === "sheet" ? SheetTitle : DialogTitle
  const Description = layout === "sheet" ? SheetDescription : DialogDescription
  const sheet = layout === "sheet"

  return (
    <form ref={formRef} noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <header className={cn("flex flex-col gap-3 border-b px-4 pt-4 pb-3 sm:px-6", sheet && "pt-[max(1rem,env(safe-area-inset-top))]")}>
        {/* Room for the close button on the title only, so the stepper has the whole width and its names fit on a phone. */}
        <div className="flex flex-col gap-0.5 pr-10">
          <Title className="font-heading text-lg font-semibold">Book appointment</Title>
          <Description className="text-sm text-muted-foreground">{`${dealership.name} · times in ${timeZone}`}</Description>
        </div>
        {!booked && <Stepper step={step} />}
      </header>

      <div className={cn("flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6", booked && "flex flex-col justify-center")}>
        {booked ? (
          <BookedState appointment={booked} timeZone={timeZone} onViewOnBoard={() => onViewOnBoard(booked)} onBookAnother={bookAnother} />
        ) : step === 1 ? (
          <StepOne
            form={form}
            headingRef={stepHeading}
            dealership={dealership}
            today={today}
            serviceTypes={serviceTypes.data}
            serviceTypesLoading={serviceTypes.isPending}
            serviceTypesError={serviceTypesFailure}
            serviceTypesRetrying={serviceTypes.isFetching}
            onRetryServiceTypes={() => void serviceTypes.refetch()}
            service={service}
            date={date}
            startUtc={startUtc}
            startFocusRequest={startFocusRequest}
            intake={
              triage.enabled ? (
                <BookingTriageIntake
                  triage={triage}
                  dealership={dealership}
                  today={today}
                  serviceTypes={serviceTypes.data}
                  current={{ serviceTypeId, date }}
                  notesHaveOwnText={notes !== "" && notes !== copiedNotes}
                  onUse={applySuggestion}
                />
              ) : null
            }
          />
        ) : (
          <StepTwo
            form={form}
            headingRef={stepHeading}
            problemRef={problemRef}
            service={service}
            schedule={schedule}
            startUtc={startUtc}
            timeZone={timeZone}
            notesCopied={copiedNotes !== "" && notes === copiedNotes}
            onChangeTime={back}
            problem={
              failure && !fieldErrorsOnly(failure) ? (
                <BookingProblem
                  error={failure}
                  alertRef={alertRef}
                  waiting={waiting}
                  busy={book.isPending}
                  booking={book.isPending ? book.variables?.body.startUtc : undefined}
                  onPick={bookAt}
                  onRetry={retry}
                  onChangeTime={() => {
                    form.setValue("startUtc", "")
                    back()
                  }}
                  onStartOver={() => {
                    idempotencyKey.current = crypto.randomUUID()
                    bookAnother()
                  }}
                />
              ) : null
            }
          />
        )}
      </div>

      {!booked && (
        <footer
          className={cn(
            "flex items-center justify-end gap-2 border-t bg-muted/50 px-4 py-3 sm:px-6",
            sheet && "sticky bottom-0 bg-popover pb-[max(0.75rem,env(safe-area-inset-bottom))] *:h-11 *:flex-1"
          )}
        >
          {step === 2 && (
            <Button type="button" variant="secondary" onClick={back} disabled={book.isPending}>
              Back
            </Button>
          )}
          {/* Distinct keys: React must not turn the clicked Next button into the submit button while its click is still
              being handled, or the browser's default action would submit step 2 on arrival. */}
          {step === 1 ? (
            <Button key="next" type="button" onClick={() => void next()}>
              Next
            </Button>
          ) : (
            // Focusable while it waits (booking, or a rate limit's wait): it was just pressed, and focus must stay in the dialog.
            // Base UI also turns a press, or Enter in a field, into nothing meanwhile.
            <Button
              key="book"
              type="submit"
              disabled={book.isPending || waiting > 0}
              focusableWhenDisabled
              aria-busy={book.isPending || undefined}
            >
              {book.isPending && <LoaderCircle aria-hidden="true" className="animate-spin" />}
              {book.isPending ? "Booking…" : waiting > 0 ? `Book (in ${waiting} s)` : "Book"}
            </Button>
          )}
        </footer>
      )}
    </form>
  )
}

const steps = ["Service & time", "Customer & vehicle"] as const

/** Two numbered steps, a real sequence: the current one marked for assistive technology, a done one with a check. */
function Stepper({ step }: { step: Step }) {
  return (
    <ol aria-label="Booking steps" className="flex min-w-0 items-center gap-1.5 sm:gap-2">
      {steps.map((name, index) => {
        const number = (index + 1) as Step
        const state = number < step ? "done" : number === step ? "current" : "upcoming"
        return (
          <li key={name} aria-current={state === "current" ? "step" : undefined} className="flex min-w-0 items-center gap-1.5 sm:gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                state === "current" && "bg-primary text-primary-foreground",
                state === "done" && "bg-success text-success-foreground",
                state === "upcoming" && "border border-input text-muted-foreground"
              )}
            >
              {state === "done" ? <Check className="size-3.5" /> : number}
            </span>
            <span className={cn("truncate text-sm font-medium", state === "upcoming" && "text-muted-foreground")}>
              <span className="sr-only">{`Step ${number}: `}</span>
              {name}
              {state === "done" && <span className="sr-only"> (completed)</span>}
            </span>
            {index === 0 && <span aria-hidden="true" className="h-px w-3 shrink-0 bg-border sm:w-8" />}
          </li>
        )
      })}
    </ol>
  )
}

type BookingFormApi = ReturnType<typeof useForm<BookingFormInput, unknown, BookingForm>>

interface StepOneProps {
  form: BookingFormApi
  headingRef: RefObject<HTMLHeadingElement | null>
  dealership: DealershipResponse
  today: string
  serviceTypes: ServiceTypeResponse[] | undefined
  serviceTypesLoading: boolean
  serviceTypesError: unknown
  /** True while Try again loads the services again. */
  serviceTypesRetrying: boolean
  onRetryServiceTypes: () => void
  service: ServiceTypeResponse | undefined
  date: string
  startUtc: string
  /** Raised to move focus into the free starts once they are on screen (a suggestion was just used). */
  startFocusRequest: number
  /** Booking intake triage above the service, when suggestions are on. */
  intake: ReactNode
}

/** The calendar's day names, with "closed" after a day the dealership does not open (struck through and disabled). */
const dayLabels = {
  labelDayButton: (...args: Parameters<typeof labelDayButton>) => {
    const [, modifiers] = args
    return modifiers.closed ? `${labelDayButton(...args)}, closed` : labelDayButton(...args)
  },
}

function StepOne({
  form,
  headingRef,
  dealership,
  today,
  serviceTypes,
  serviceTypesLoading,
  serviceTypesError,
  serviceTypesRetrying,
  onRetryServiceTypes,
  service,
  date,
  startUtc,
  startFocusRequest,
  intake,
}: StepOneProps) {
  const ids = { service: useId(), date: useId(), start: useId(), startError: useId() }
  const [calendarOpen, setCalendarOpen] = useState(false)
  const isClosed = (day: Date) => !openingHoursOn(dealership, weekdayOf(fromPickerDate(day)))
  const items = (serviceTypes ?? []).map((candidate) => ({ value: candidate.id, label: candidate.name }))
  const startError = form.formState.errors.startUtc?.message

  return (
    <section aria-labelledby={`${ids.service}-heading`} className="flex flex-col gap-5">
      <h3 id={`${ids.service}-heading`} ref={headingRef} tabIndex={-1} className="font-heading text-base font-semibold outline-none">
        Service and time
      </h3>
      {intake}
      <FieldGroup className="grid gap-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Controller
          control={form.control}
          name="serviceTypeId"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined} className="gap-1.5">
              <FieldLabel htmlFor={ids.service}>Service</FieldLabel>
              {serviceTypesError ? (
                <ProblemAlert
                  title="Couldn’t load the services"
                  error={serviceTypesError}
                  onRetry={onRetryServiceTypes}
                  retrying={serviceTypesRetrying}
                />
              ) : serviceTypesLoading ? (
                <Skeleton className="h-10 w-full rounded-lg" />
              ) : (
                <Select
                  items={items}
                  value={field.value || null}
                  onValueChange={(value) => {
                    field.onChange(value ?? "")
                    // A start belongs to one service's availability.
                    form.setValue("startUtc", "")
                  }}
                >
                  <SelectTrigger
                    id={ids.service}
                    ref={field.ref}
                    aria-invalid={fieldState.invalid || undefined}
                    className="w-full cursor-pointer"
                  >
                    <SelectValue placeholder="Choose a service" />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {(serviceTypes ?? []).map((candidate) => (
                        <SelectItem key={candidate.id} value={candidate.id} disabled={!candidate.bookable} className="py-2">
                          <span className="flex min-w-0 flex-col gap-1 whitespace-normal">
                            <span className="flex items-baseline gap-2">
                              <span className="font-medium">{candidate.name}</span>
                              <span className="text-xs text-muted-foreground tabular-nums">{`${candidate.durationMinutes} min`}</span>
                            </span>
                            {candidate.bookable ? (
                              <CapabilityBadges
                                capabilities={candidate.requiredBayCapabilities}
                                certifications={candidate.requiredCertifications}
                                distinctiveOnly
                                label="Needs"
                                max={3}
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">Not offered here: no qualified bay or technician</span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
              {service && (
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="tabular-nums">{`${service.durationMinutes} min`}</span>
                  <CapabilityBadges
                    capabilities={service.requiredBayCapabilities}
                    certifications={service.requiredCertifications}
                    label="Needs"
                    max={4}
                  />
                </span>
              )}
              <FormError message={fieldState.error?.message} />
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="date"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined} className="gap-1.5">
              <FieldLabel htmlFor={ids.date}>Date</FieldLabel>
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      id={ids.date}
                      ref={field.ref}
                      type="button"
                      variant="outline"
                      aria-label={`Date, ${formatDay(field.value, "long")}`}
                      className="w-full cursor-pointer justify-start font-normal tabular-nums"
                    />
                  }
                >
                  <CalendarDays aria-hidden="true" className="text-muted-foreground" />
                  {formatDay(field.value, "short")}
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto max-w-[calc(100vw-1rem)] p-0">
                  <PopoverTitle className="sr-only">Choose the day</PopoverTitle>
                  <Calendar
                    mode="single"
                    selected={toPickerDate(field.value)}
                    defaultMonth={toPickerDate(field.value)}
                    today={toPickerDate(today)}
                    disabled={[{ before: toPickerDate(today) }, isClosed]}
                    onSelect={(picked) => {
                      if (!picked) return
                      field.onChange(fromPickerDate(picked))
                      form.setValue("startUtc", "")
                      setCalendarOpen(false)
                    }}
                    modifiers={{ closed: isClosed }}
                    modifiersClassNames={{ closed: "[&_button]:line-through" }}
                    labels={dayLabels}
                    className="w-full [&_button]:cursor-pointer max-md:[--cell-size:--spacing(10)]"
                  />
                  <p className="w-0 min-w-full border-t px-3 py-2 text-xs text-pretty text-muted-foreground">
                    {`Struck-through days are closed. Dates follow ${dealership.timeZoneId}.`}
                  </p>
                </PopoverContent>
              </Popover>
              <FormError message={fieldState.error?.message} />
            </Field>
          )}
        />
      </FieldGroup>

      <Controller
        control={form.control}
        name="startUtc"
        render={({ field }) => (
          <div ref={(element) => field.ref(element?.querySelector("[role=radio]") ?? element)} className="flex flex-col gap-2">
            <span id={ids.start} className="text-sm font-medium">
              Start time
            </span>
            <AvailabilityChips
              dealershipId={dealership.id}
              serviceType={service}
              date={date}
              value={startUtc}
              onValueChange={(value) => field.onChange(value)}
              labelledBy={ids.start}
              describedBy={startError ? ids.startError : undefined}
              invalid={Boolean(startError)}
              nextDate={nextOpenDate(dealership, date)}
              onDateChange={(next) => {
                form.setValue("date", next)
                form.setValue("startUtc", "")
              }}
              focusRequest={startFocusRequest}
            />
            <FormError id={ids.startError} message={startError} />
          </div>
        )}
      />
    </section>
  )
}

interface StepTwoProps {
  form: BookingFormApi
  headingRef: RefObject<HTMLHeadingElement | null>
  problemRef: RefObject<HTMLDivElement | null>
  service: ServiceTypeResponse | undefined
  schedule: WorkshopScheduleResponse | undefined
  startUtc: string
  timeZone: string
  /** The notes are the issue description, copied from step 1 (the box there was ticked). */
  notesCopied: boolean
  onChangeTime: () => void
  problem: ReactNode
}

const ANY = "any"

function StepTwo({ form, headingRef, problemRef, service, schedule, startUtc, timeZone, notesCopied, onChangeTime, problem }: StepTwoProps) {
  const headingId = useId()
  // Only resources that could take this job: active, with every capability or certification the service needs.
  const bays = (schedule?.bays ?? []).filter(
    (bay) => bay.isActive && (service?.requiredBayCapabilities ?? []).every((capability) => bay.capabilities.includes(capability))
  )
  const technicians = (schedule?.technicians ?? []).filter(
    (technician) =>
      technician.isActive && (service?.requiredCertifications ?? []).every((certification) => technician.certifications.includes(certification))
  )

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <h3 id={headingId} ref={headingRef} tabIndex={-1} className="font-heading text-base font-semibold outline-none">
        Customer and vehicle
      </h3>
      {service && <Summary service={service} startUtc={startUtc} timeZone={timeZone} onChange={onChangeTime} />}
      {problem && (
        <div ref={problemRef} className="scroll-mt-4">
          {problem}
        </div>
      )}

      <FieldSet className="gap-4">
        <FieldLegend variant="label">Customer</FieldLegend>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <TextField form={form} name="customer.name" label="Name" autoComplete="name" className="sm:col-span-2" />
          <TextField form={form} name="customer.email" label="Email" type="email" inputMode="email" autoComplete="email" />
          <TextField form={form} name="customer.phone" label="Phone" type="tel" inputMode="tel" autoComplete="tel" />
        </FieldGroup>
      </FieldSet>

      <FieldSet className="gap-4">
        <FieldLegend variant="label">Vehicle</FieldLegend>
        <FieldGroup className="grid gap-4 sm:grid-cols-6">
          <TextField
            form={form}
            name="vehicle.vin"
            label="VIN"
            autoCapitalize="characters"
            spellCheck={false}
            autoComplete="off"
            maxLength={17}
            upperCase
            description="17 characters, no I, O or Q"
            inputClassName="font-mono tracking-wide uppercase"
            className="sm:col-span-6"
          />
          <TextField
            form={form}
            name="vehicle.registration"
            label="Registration"
            autoCapitalize="characters"
            spellCheck={false}
            autoComplete="off"
            maxLength={16}
            upperCase
            inputClassName="font-mono tracking-wide uppercase"
            className="sm:col-span-2"
          />
          <TextField form={form} name="vehicle.make" label="Make" autoComplete="off" className="sm:col-span-2" />
          <TextField form={form} name="vehicle.model" label="Model" autoComplete="off" className="sm:col-span-2" />
        </FieldGroup>
      </FieldSet>

      <FieldSet className="gap-4">
        <FieldLegend variant="label">Preferences (optional)</FieldLegend>
        {schedule && (
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <ResourceSelect form={form} name="preferredBayId" label="Preferred bay" anyLabel="Any free bay" options={bays} />
            <ResourceSelect
              form={form}
              name="preferredTechnicianId"
              label="Preferred technician"
              anyLabel="Any free technician"
              options={technicians}
            />
          </FieldGroup>
        )}
        <Controller
          control={form.control}
          name="notes"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined} className="gap-1.5">
              <FieldLabel htmlFor={`${headingId}-notes`}>Notes for the workshop</FieldLabel>
              <Textarea
                id={`${headingId}-notes`}
                {...field}
                value={field.value ?? ""}
                rows={2}
                maxLength={1000}
                aria-invalid={fieldState.invalid || undefined}
                aria-describedby={notesCopied ? `${headingId}-notes-copied` : undefined}
                placeholder="For example: customer waiting in the lounge"
                className="min-h-20"
              />
              {notesCopied && (
                // The description may hold personal details: say plainly that, as notes, it is kept.
                <p id={`${headingId}-notes-copied`} className="text-xs text-muted-foreground">
                  Copied from the description of the issue. Notes are saved with the booking.
                </p>
              )}
              <FormError message={fieldState.error?.message} />
            </Field>
          )}
        />
      </FieldSet>
    </section>
  )
}

/** What step 1 chose, at the top of step 2: the service, the day and time, the duration and what the job needs. */
function Summary({
  service,
  startUtc,
  timeZone,
  onChange,
}: {
  service: ServiceTypeResponse
  startUtc: string
  timeZone: string
  onChange: () => void
}) {
  const start = new Date(startUtc)
  const end = new Date(start.getTime() + service.durationMinutes * 60_000)
  const clock = (instant: Date) =>
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant)
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(start)

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-muted/60 p-3">
      <dl className="flex min-w-0 flex-col gap-1 text-sm">
        <dt className="sr-only">Service</dt>
        <dd className="font-semibold">{service.name}</dd>
        <dt className="sr-only">When</dt>
        <dd className="tabular-nums">{`${formatDay(day, "short")}, ${clock(start)} to ${clock(end)} · ${service.durationMinutes} min`}</dd>
        <dt className="sr-only">Needs</dt>
        <dd>
          <CapabilityBadges
            capabilities={service.requiredBayCapabilities}
            certifications={service.requiredCertifications}
            label="Needs"
            max={4}
          />
        </dd>
      </dl>
      <Button type="button" variant="link" className="h-auto px-0" onClick={onChange}>
        Change
      </Button>
    </div>
  )
}

type TextPath = "customer.name" | "customer.email" | "customer.phone" | "vehicle.vin" | "vehicle.registration" | "vehicle.make" | "vehicle.model"

interface TextFieldProps extends Omit<React.ComponentProps<"input">, "form" | "name"> {
  form: BookingFormApi
  name: TextPath
  label: string
  description?: string
  /** Shows capitals as they are typed (VIN, registration); the schema upper-cases the value too. */
  upperCase?: boolean
  inputClassName?: string
}

function TextField({ form, name, label, description, upperCase = false, inputClassName, className, ...input }: TextFieldProps) {
  const id = useId()
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined} className={cn("gap-1.5", className)}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Input
            id={id}
            {...input}
            {...field}
            onChange={(event) => field.onChange(upperCase ? event.target.value.toUpperCase() : event.target.value)}
            aria-invalid={fieldState.invalid || undefined}
            aria-describedby={[fieldState.error ? errorId : null, description ? descriptionId : null].filter(Boolean).join(" ") || undefined}
            className={cn("scroll-mt-24 scroll-mb-28", inputClassName)}
          />
          {description && !fieldState.error && (
            <p id={descriptionId} className="text-xs text-muted-foreground">
              {description}
            </p>
          )}
          <FormError id={errorId} message={fieldState.error?.message} />
        </Field>
      )}
    />
  )
}

interface ResourceSelectProps {
  form: BookingFormApi
  name: "preferredBayId" | "preferredTechnicianId"
  label: string
  anyLabel: string
  options: ReadonlyArray<{ id: string; name: string }>
}

function ResourceSelect({ form, name, label, anyLabel, options }: ResourceSelectProps) {
  const id = useId()
  const items = [{ value: ANY, label: anyLabel }, ...options.map((option) => ({ value: option.id, label: option.name }))]
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined} className="gap-1.5">
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Select items={items} value={field.value ?? ANY} onValueChange={(value) => field.onChange(!value || value === ANY ? undefined : value)}>
            <SelectTrigger id={id} ref={field.ref} aria-invalid={fieldState.invalid || undefined} className="w-full cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FormError message={fieldState.error?.message} />
        </Field>
      )}
    />
  )
}

/** A field's error under it, with the field-error icon (DESIGN_SYSTEM 11.4). */
function FormError({ id, message }: { id?: string; message?: string }) {
  if (!message) return null
  return (
    <FieldError id={id} className="flex items-start gap-1.5">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </FieldError>
  )
}

interface BookingProblemProps {
  error: unknown
  /** The alert, for the dialog to focus when the control that was pressed went with the last refusal. */
  alertRef: Ref<HTMLDivElement>
  /** Seconds left of a rate limit's wait. */
  waiting: number
  /** True while this booking is tried again: the refusal stays, and its controls wait (focusable) for the answer. */
  busy: boolean
  /** The start being booked meanwhile (`startUtc`), so a suggested start that was picked says it is booking. */
  booking?: string
  onPick: (slot: { startUtc: string; startLocal: string }) => void
  onRetry: () => void
  onChangeTime: () => void
  onStartOver: () => void
}

/**
 * Why a booking was refused, in place (DESIGN_SYSTEM 11.16): a taken slot with the API's suggested starts, a business rule
 * (with what is missing, or a way back to pick another time), a rate limit with its wait, or a failure with a safe retry.
 * Field errors (`400`) are on their fields; this shows only the ones no field owns.
 */
function BookingProblem({ error, alertRef, waiting, busy, booking, onPick, onRetry, onChangeTime, onStartOver }: BookingProblemProps) {
  const problem = parseProblem(error)
  const slug = problem ? problemSlug(problem) : ""
  const status = problem?.status ?? (error instanceof UnexpectedResponseError ? error.status : undefined)

  if (slug === "validation-error" && problem) {
    const unclaimed = unclaimedErrors(problem)
    return (
      <ProblemAlert tone="warning" title="Check the highlighted details" error={error} focusRef={alertRef}>
        <ul className="list-disc pl-4">
          {unclaimed.map(([path, message]) => (
            <li key={path}>{message}</li>
          ))}
        </ul>
      </ProblemAlert>
    )
  }

  if (slug === "slot-unavailable" || slug === "slot-conflict") {
    // The API lists them nearest first; in time order they are easier to scan.
    const suggestions = [...(problem?.suggestedSlots ?? [])].sort((a, b) => a.startUtc.localeCompare(b.startUtc))
    return (
      <ProblemAlert tone="warning" title="Slot just taken - pick another time" error={error} focusRef={alertRef}>
        {suggestions.length > 0 ? (
          <span className="flex flex-col gap-2 pt-1">
            <span className="text-sm font-medium">Free nearby, same service:</span>
            <SuggestedSlotChips slots={suggestions} onPick={onPick} disabled={busy} booking={booking} />
          </span>
        ) : (
          <span>No other start is free that day.</span>
        )}
        <span>
          <Button type="button" variant="link" className="h-auto px-0" onClick={onChangeTime} disabled={busy}>
            Choose another time
          </Button>
        </span>
      </ProblemAlert>
    )
  }

  if (status === 422) {
    const missing = {
      capabilities: (problem?.missingCapabilities as string[] | undefined) ?? [],
      certifications: (problem?.missingCertifications as string[] | undefined) ?? [],
    }
    return (
      <ProblemAlert
        tone="warning"
        title={problem?.title ?? "This booking breaks a workshop rule"}
        error={error}
        focusRef={alertRef}
        actions={
          timeRules.has(slug) ? (
            <Button type="button" variant="outline" size="sm" onClick={onChangeTime} disabled={busy}>
              Pick another time
            </Button>
          ) : slug === "idempotency-key-reuse" ? (
            <Button type="button" variant="outline" size="sm" onClick={onStartOver} disabled={busy}>
              Start a new booking
            </Button>
          ) : undefined
        }
      >
        {slug === "idempotency-key-reuse" && <span>An earlier attempt of this booking went through. Check the board before booking again.</span>}
        <MissingList label="No bay here has:" names={missing.capabilities} />
        <MissingList label="No technician here is certified for:" names={missing.certifications} />
      </ProblemAlert>
    )
  }

  if (status === 429) {
    return (
      <ProblemAlert
        tone="info"
        title={waiting > 0 ? `Too many requests - try again in ${waiting} s` : "Too many requests - try again now"}
        error={error}
        focusRef={alertRef}
      />
    )
  }

  if (status === 404) {
    return <ProblemAlert tone="warning" title={problem?.title ?? "Not found"} error={error} focusRef={alertRef} />
  }

  if (status !== undefined && status < 500) {
    return <ProblemAlert tone="warning" title={problem?.title ?? `The server answered ${status}`} error={error} focusRef={alertRef} />
  }

  return (
    <ProblemAlert title="Couldn’t book the appointment" error={error} onRetry={onRetry} retrying={busy} focusRef={alertRef}>
      <span>Trying again is safe: it sends the same booking, which the server can only make once.</span>
    </ProblemAlert>
  )
}

/** A `400`'s field errors that no form field shows (an `Idempotency-Key` problem, a path the form does not have). */
function unclaimedErrors(problem: ProblemDetails): Array<[string, string]> {
  return Object.entries(fieldErrors(problem)).filter(([path]) => !(formPaths as readonly string[]).includes(path))
}

/** A `400` whose every message already sits under its field: nothing to add above the form. */
function fieldErrorsOnly(error: unknown): boolean {
  const problem = parseProblem(error)
  return problem !== null && problemSlug(problem) === "validation-error" && unclaimedErrors(problem).length === 0
}

/** What a `no-qualified-resources` refusal says is missing on one side (bays or technicians), as outline badges. */
function MissingList({ label, names }: { label: string; names: readonly string[] }) {
  if (names.length === 0) return null
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-sm">{label}</span>
      {names.map((name) => (
        <Badge key={name} variant="outline">
          {featureLabel(name)}
        </Badge>
      ))}
    </span>
  )
}

/**
 * The phone sheet's last state: the booking-success illustration, what was booked, and where to go next. Book left with
 * the form, so View on board takes focus as the state mounts (in the commit, before the sheet's focus guard would put lost
 * focus on the sheet itself).
 */
function BookedState({
  appointment,
  timeZone,
  onViewOnBoard,
  onBookAnother,
}: {
  appointment: AppointmentResponse
  timeZone: string
  onViewOnBoard: () => void
  onBookAnother: () => void
}) {
  const day = appointment.startLocal.slice(0, 10)
  return (
    <IllustratedState
      illustration="booking-success"
      level={2}
      title="Booked"
      role="status"
      action={
        <>
          <Button type="button" onClick={onViewOnBoard} autoFocus>
            View on board
            <ChevronRight aria-hidden="true" />
          </Button>
          <Button type="button" variant="signal" onClick={onBookAnother}>
            <RotateCw aria-hidden="true" />
            Book another
          </Button>
        </>
      }
    >
      <p className="font-medium text-foreground">{`${appointment.serviceType.name} · ${appointment.bay.name} · ${appointment.technician.name}`}</p>
      <p className="tabular-nums">{`${formatDay(day, "long").replace(/ \d{4}$/, "")}, ${localTime(appointment.startLocal)} to ${localTime(appointment.endLocal)} (${timeZone})`}</p>
    </IllustratedState>
  )
}
