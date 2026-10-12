/*
 * Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/calendar/components/event-form.tsx` and
 * `src/app/users/components/user-form-dialog.tsx`, Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the
 * README's licence section): the event form's dialog, date field and select layout, and the user form dialog's
 * react-hook-form + zod + `Field` pattern. Adapted to the generated API client, the two-step stepper, slot chips instead of
 * free time inputs, the full-screen sheet on phones and the design system (UI_DESIGN 11.14).
 */
import { zodResolver } from "@hookform/resolvers/zod"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarDays, Check, ChevronRight, CircleAlert, LoaderCircle, RotateCw, TriangleAlert } from "lucide-react"
import { type FormEvent, type ReactNode, type Ref, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { Controller, type FieldPath, useForm, useWatch } from "react-hook-form"
import { labelDayButton } from "react-day-picker"

import {
  bookAppointmentMutation,
  getAvailabilityQueryKey,
  getServiceTypesOptions,
  getWorkshopScheduleQueryKey,
  resolveVehicleProfileMutation,
} from "@/api/@tanstack/react-query.gen"
import type {
  AppointmentResponse,
  BookAppointmentRequest,
  DealershipResponse,
  GetAvailabilityData,
  Powertrain,
  ServiceTypeResponse,
  VehicleClass,
  VehicleProfile,
  WorkshopScheduleResponse,
} from "@/api/types.gen"
import { SignInAction } from "@/components/auth/sign-in-action"
import { WriteReason } from "@/components/auth/write-reason"
import { CapabilityBadges } from "@/components/capability-badges"
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
import { useCurrentUser, type WriteAccess, writeAccessOf } from "@/hooks/use-current-user"
import { useMutationFailure } from "@/hooks/use-mutation-failure"
import { useQueryFailure } from "@/hooks/use-query-failure"
import { useWriteMutation } from "@/hooks/use-write-mutation"
import { rangeReadsOf } from "@/lib/appointment-range"
import { formatDay, fromPickerDate, toPickerDate, weekdayOf } from "@/lib/calendar-date"
import { cachedVehicleAware, featureSwitchesQuery, useVehicleAware, vehicleAwareRefused } from "@/lib/feature-switches"
import { featureLabel } from "@/lib/features"
import { nextOpenDate, openingHoursOn } from "@/lib/opening-hours"
import {
  authRefusalTitle,
  describeFailure,
  fieldErrors,
  parseProblem,
  type ProblemDetails,
  problemSlug,
  UnexpectedResponseError,
} from "@/lib/problem-details"
import { cachedIdentityKey } from "@/lib/session"
import { withSpan } from "@/lib/telemetry"
import { cn } from "@/lib/utils"
import { type AvailabilityVehicle, knownManufacturer, liveDiagnosisApplies, manufacturerCode } from "@/lib/vehicle-aware"

import { bookingTriageStatusQuery, useBookingTriage } from "../hooks/use-booking-triage"
import { type BookedExplanation, explainBooking } from "../lib/allocation"
import { localTime } from "../lib/appointment-text"
import {
  bookingSchemaFor,
  type BookingForm,
  type BookingFormInput,
  declaresVehicle,
  stepOneFieldsFor,
  toBookingRequest,
  undeclaredProfile,
} from "../lib/booking-schema"
import { AllocationExplanationView } from "./allocation-explanation"
import { AvailabilityChips, SuggestedSlotChips } from "./availability-chips"
import { BookingTriageIntake } from "./booking-triage"
import {
  DeclaredVehicle,
  type Lookup,
  ProfileConflictProblem,
  QualificationGap,
  VehicleFacts,
  VehicleInputsDropped,
  VehicleProfileFields,
  VinField,
} from "./vehicle-step"

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
  /** Phones: a full-screen sheet that ends on a success state instead of closing (UI_DESIGN 11.14). */
  fullScreen: boolean
  /**
   * A booking was made (the board refreshes and highlights it; on wide screens the dialog has closed), with its allocation
   * explained when vehicle-aware requirements are on and the answer carries one: the sentences, and why a preference was
   * not followed, named from `schedule`.
   */
  onBooked: (appointment: AppointmentResponse, explanation?: BookedExplanation | null) => void
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
export function BookingDialog({ open, onOpenChange, fullScreen, ...props }: BookingDialogProps) {
  // Whether to offer suggestions, read while the dialog is still closed (see `bookingTriageStatusQuery`).
  useQuery(bookingTriageStatusQuery())
  // Likewise the vehicle-aware switch, so the vehicle step is in place from the dialog's first frame, not added under the
  // person's pointer a moment later.
  useQuery(featureSwitchesQuery())
  const queryClient = useQueryClient()
  const owner = useCurrentUser().writer
  // The phone's success state, kept here so a discard knows a booking had been made.
  const [booked, setBooked] = useState<AppointmentResponse | null>(null)
  // The booking being entered belongs to the account that opened the dialog (`CurrentUser.writer`). When the identity
  // changes to one that may not book, or to another email, it is discarded in the same render (the flow starts again under
  // a new key: its fields, the description and the photos' previews go, and their object URLs are revoked), and the dialog
  // says so. A change between two roles that may book, for the same email, keeps it (`owner` does not change). Its writes
  // are bound to the same account (`useWriteMutation`), so nothing of a discarded booking is ever sent, by any path.
  const [draft, setDraft] = useState<{ owner: string | null; key: number; discard: Discard | null }>({ owner, key: 0, discard: null })
  if (owner !== draft.owner) {
    const held = draft.owner !== null
    setDraft({
      owner,
      key: held ? draft.key + 1 : draft.key,
      discard: held
        ? { booked: booked !== null, bookWasPending: queryClient.isMutating({ mutationKey: BOOK_MUTATION_KEY }) > 0 }
        : draft.discard,
    })
    if (held) setBooked(null)
  }
  const flow = { ...props, discard: draft.discard, booked, onBookedChange: setBooked }
  if (fullScreen) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          // Every override carries the sheet's own `data-[side=bottom]:` variant: tailwind-merge then replaces the bottom sheet's
          // auto height, 85dvh cap and radius (a bare `h-dvh` loses to the variant's `h-auto` on specificity).
          className="gap-0 overflow-clip p-0 data-[side=bottom]:h-dvh data-[side=bottom]:max-h-dvh data-[side=bottom]:rounded-none *:data-[slot=sheet-close]:top-2 *:data-[slot=sheet-close]:right-2"
        >
          <BookingFlow key={draft.key} {...flow} layout="sheet" onClose={() => onOpenChange(false)} />
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 shadow-xl sm:max-w-2xl">
        <BookingFlow key={draft.key} {...flow} layout="dialog" onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

type Layout = "dialog" | "sheet"
type BookVariables = Parameters<NonNullable<ReturnType<typeof bookAppointmentMutation>["mutationFn"]>>[0]
type Step = 1 | 2

interface BookingFlowProps extends Omit<BookingDialogProps, "open" | "onOpenChange" | "fullScreen"> {
  layout: Layout
  onClose: () => void
  /** Why the booking being entered was discarded while the dialog was open, if it was. */
  discard: Discard | null
  /** The phone's success state (held by the dialog). */
  booked: AppointmentResponse | null
  onBookedChange: (booked: AppointmentResponse | null) => void
}

/** A booking being entered that the dialog discarded when the identity changed. */
interface Discard {
  /** It had been booked (the phone's success state was showing). */
  booked: boolean
  /** Book had been pressed and had no answer yet: it may have been booked. */
  bookWasPending: boolean
}

/** The booking request's mutation key, so the dialog can tell whether a Book is still out when it discards a draft. */
const BOOK_MUTATION_KEY = ["bookAppointment"]
/** The VIN look-up's (`POST /vehicle-profiles/resolve`). */
const RESOLVE_MUTATION_KEY = ["resolveVehicleProfile"]

type ResolveVariables = Parameters<NonNullable<ReturnType<typeof resolveVehicleProfileMutation>["mutationFn"]>>[0]

const WHOLE_VIN = /^[A-HJ-NPR-Z0-9]{17}$/
const MANUFACTURER_CODE = /^[A-Z0-9-]{1,32}$/

/** A value at a dotted path of a nested object (a form's errors). */
const at = (value: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined), value)

const blank = (date: string): BookingFormInput => ({
  serviceTypeId: "",
  date,
  startUtc: "",
  customer: { name: "", email: "", phone: "" },
  vehicle: { vin: "", registration: "", make: "", model: "", profile: undeclaredProfile() },
  needsLiveDiagnosis: false,
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
  "vehicle.profile.powertrain": "Powertrain",
  "vehicle.profile.vehicleClass": "Vehicle class",
  "vehicle.profile.manufacturer": "Manufacturer",
  "vehicle.profile.declarationReason": "Reason",
  needsLiveDiagnosis: "Live HV diagnosis",
} satisfies Partial<Record<FieldPath<BookingFormInput>, string>>

const formPaths = Object.keys(formLabels) as ReadonlyArray<keyof typeof formLabels>

/** Business rules about the start time (§8.7): the fix is another start, back on step 1. */
const timeRules = new Set(["outside-operating-hours", "lead-time-not-met", "beyond-booking-horizon", "slot-not-aligned"])

function BookingFlow({
  dealership,
  schedule,
  initialDate,
  today,
  layout,
  onBooked,
  onViewOnBoard,
  onClose,
  discard,
  booked,
  onBookedChange: setBooked,
}: BookingFlowProps) {
  const dealershipId = dealership.id
  const timeZone = dealership.timeZoneId
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>(1)
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
  // The dialog opens only for an account that may book, but the identity can change while it is open (a sign-out in
  // another tab, a session that ended, a role removed): the dialog then discards what was typed (`BookingDialog`), and
  // Book, Suggest a service, its Try again and the photos stop, named by the notice that says why.
  const current = useCurrentUser()
  const access = writeAccessOf(current)
  const blocked = access.state === "sign-in" || access.state === "denied"
  const blockedId = useId()
  const noticeRef = useRef<HTMLDivElement>(null)
  const discardedId = useId()
  // Vehicle-aware requirements (ADR-029), as the environment's switch says: off, the flow is today's and nothing of the
  // vehicle step is shown or sent.
  const vehicleAware = useVehicleAware()
  const vehicleSectionRef = useRef<HTMLDivElement>(null)
  const manufacturerRef = useRef<HTMLInputElement | null>(null)
  const focusVehicle = useRef(false)

  const form = useForm<BookingFormInput, unknown, BookingForm>({
    // The vehicle step's rules apply while its declaration can be sent: the switch as the cache holds it when checked.
    resolver: (values, context, options) => zodResolver(bookingSchemaFor(cachedVehicleAware(queryClient)))(values, context, options),
    defaultValues: blank(initialDate),
    mode: "onTouched",
  })
  const [serviceTypeId, date, startUtc, notes = "", powertrain = "Unknown", vehicleClass = "Unknown", liveAsked = false, vin = "", declaredManufacturer = ""] =
    useWatch({
      control: form.control,
      name: [
        "serviceTypeId",
        "date",
        "startUtc",
        "notes",
        "vehicle.profile.powertrain",
        "vehicle.profile.vehicleClass",
        "needsLiveDiagnosis",
        "vehicle.vin",
        "vehicle.profile.manufacturer",
      ],
    }) as [string, string, string, string | undefined, Powertrain | undefined, VehicleClass | undefined, boolean | undefined, string | undefined, string | undefined]
  const serviceTypesOptions = getServiceTypesOptions({ path: { dealershipId } })
  const serviceTypes = useQuery(serviceTypesOptions)
  // Kept while Try again loads them again, so the alert and its focused button stay in the dialog until the answer.
  const serviceTypesFailure = useQueryFailure(serviceTypes, serviceTypesOptions.queryKey)
  const service = serviceTypes.data?.find((candidate) => candidate.id === serviceTypeId)
  const serviceFor = (id: string) => serviceTypes.data?.find((candidate) => candidate.id === id)

  // Booking intake triage (§8.10): optional, above the service. Its state outlives step 1, for when the person comes back.
  const triage = useBookingTriage(dealershipId)
  // What the dialog last copied into Notes from the description: notes that still read exactly that are the copy, not the
  // person's own words, so they can follow the description (or go when the box is unticked); anything else is never touched.
  const [copiedNotes, setCopiedNotes] = useState("")
  // Raised when a suggestion is used, so focus moves on to its free starts once they are on screen.
  const [startFocusRequest, setStartFocusRequest] = useState(0)

  // The VIN look-up (`POST /vehicle-profiles/resolve`, BookingsWrite): a write like Book, bound to the account the dialog was
  // drawn for and checked as its request leaves (`write.fetch`). The VIN goes in the body only, never in a URL or a query
  // key. Its answer is kept with the VIN and the identity it was read for, so it never shows for another VIN or caller.
  const [resolved, setResolved] = useState<{ identity: string; vin: string; profile: VehicleProfile } | null>(null)
  const [lookupWaiting, startLookupWaiting] = useCountdown()
  const generatedResolve = resolveVehicleProfileMutation()
  const resolve = useWriteMutation({
    mutationKey: RESOLVE_MUTATION_KEY,
    mutationFn: (variables: ResolveVariables, write, context) => generatedResolve.mutationFn!({ ...variables, fetch: write.fetch() }, context),
    // Kept for the caller its request left as (the cache's, when the answer is used: `useWriteMutation` throws away an answer
    // whose caller changed after it left).
    onSuccess: (profile, variables) => setResolved({ identity: cachedIdentityKey(queryClient), vin: variables.body.vin ?? "", profile }),
    onError: (error) => {
      const problem = parseProblem(error)
      if (problem && problemSlug(problem) === "validation-error") {
        const message = fieldErrors(problem, { vin: "VIN" }).vin
        if (message) form.setError("vehicle.vin", { type: "server", message })
      }
      if (problem?.status === 429) startLookupWaiting(Math.max(1, Math.ceil(Number(problem.retryAfterSeconds ?? 1))))
    },
  })
  const wholeVin = vin.trim().toUpperCase()
  const resolvedHere = resolved && resolved.identity === current.identity && resolved.vin === wholeVin ? resolved.profile : null
  const resolveForThisVin = resolve.variables?.body.vin === wholeVin
  const resolveProblem = parseProblem(resolve.error)
  const lookup: Lookup =
    resolve.isPending && resolveForThisVin
      ? { state: "pending" }
      : resolvedHere
        ? { state: "done", profile: resolvedHere }
        : resolve.isError && resolveForThisVin && !(resolveProblem && problemSlug(resolveProblem) === "validation-error")
          ? { state: "failed", error: resolve.error }
          : { state: "idle" }
  const decoded = resolvedHere ? knownManufacturer(resolvedHere.manufacturer) : null

  function lookUp(trigger: "button" | "blur") {
    if (blocked || lookupWaiting > 0) return
    const value = form.getValues("vehicle.vin").trim().toUpperCase()
    if (!WHOLE_VIN.test(value)) {
      if (trigger === "button") void form.trigger("vehicle.vin", { shouldFocus: true })
      return
    }
    // Leaving the field looks up a VIN once; the button always asks again.
    if (trigger === "blur" && ((resolve.isPending && resolveForThisVin) || (resolved?.vin === value && resolved.identity === current.identity))) return
    resolve.mutate({ body: { vin: value } })
  }

  // A declared manufacturer that disagrees with the VIN: the advisor's choice to book with the decoded data holds for that
  // declaration and that decoded value only, so editing either asks again.
  const declaredCode = manufacturerCode(declaredManufacturer)
  const [decision, setDecision] = useState<{ declared: string; decoded: string | null } | null>(null)
  const useDecoded = decision !== null && decision.declared === declaredCode && (decision.decoded === null || decision.decoded === decoded)

  // What the free starts are counted for: never the VIN, the registration or the reason (ADR-029, §8.7).
  const liveApplies = liveDiagnosisApplies(service, powertrain)
  const availabilityVehicle: AvailabilityVehicle | null = vehicleAware
    ? {
        powertrain,
        vehicleClass,
        manufacturer: decoded ?? (MANUFACTURER_CODE.test(declaredCode) ? declaredCode : undefined),
        needsLiveDiagnosis: liveAsked && liveApplies,
      }
    : null

  // The API refused vehicle-aware inputs (`422 vehicle-aware-requirements-disabled`), or the switch turned off while some
  // were entered: they are dropped (the step goes back to Unknown) and the dialog says so once.
  const [dropped, setDropped] = useState<"booking" | "availability" | "switch" | null>(null)
  const [seenVehicleAware, setSeenVehicleAware] = useState(vehicleAware)
  if (seenVehicleAware !== vehicleAware) {
    setSeenVehicleAware(vehicleAware)
    if (vehicleAware) setDropped(null)
    else if (dropped === null && declaresVehicle(form.getValues("vehicle.profile"), form.getValues("needsLiveDiagnosis"))) setDropped("switch")
  }
  useEffect(() => {
    if (!dropped) return
    form.setValue("vehicle.profile", undeclaredProfile())
    form.setValue("needsLiveDiagnosis", false)
    form.clearErrors(["vehicle.profile", "needsLiveDiagnosis"])
  }, [dropped, form])

  function vehicleRefused(from: "booking" | "availability") {
    setDropped(from)
    void vehicleAwareRefused(queryClient)
  }

  // Who is signed in changed before Book's answer arrived, so the answer was thrown away (`useWriteMutation`).
  const [answerDiscarded, setAnswerDiscarded] = useState(false)
  const generated = bookAppointmentMutation()
  const book = useWriteMutation({
    mutationKey: BOOK_MUTATION_KEY,
    // The generated mutation, inside a `ui.book_appointment` span whose fetch carries `traceparent` to the API, so one trace
    // runs from the click to PostgreSQL in the Aspire dashboard. The account is checked inside that fetch, as the request
    // leaves (`write.fetch`); an answer that arrives after the identity changed is thrown away, with no toast, no closing
    // and nothing kept.
    mutationFn: (variables: BookVariables, write, context) =>
      withSpan("ui.book_appointment", ({ fetch }) => generated.mutationFn!({ ...variables, fetch: write.fetch(fetch) }, context), {
        "keyloop.dealership_id": dealershipId,
        "keyloop.service_type_id": variables.body.serviceTypeId,
      }),
    onDiscarded: () => setAnswerDiscarded(true),
    onSuccess: (appointment) => {
      idempotencyKey.current = crypto.randomUUID()
      // The allocation, explained, while the switch is on and the answer carries one (a vehicle-aware booking); a preference
      // not followed is named from the roster the dialog offered it from.
      const explanation =
        cachedVehicleAware(queryClient) && appointment.allocation
          ? explainBooking(appointment, appointment.allocation, serviceFor(appointment.serviceType.id), schedule)
          : null
      const day = appointment.startLocal.slice(0, 10)
      void queryClient.invalidateQueries({ queryKey: getWorkshopScheduleQueryKey({ path: { dealershipId }, query: { date: day } }) })
      // Every service's availability that day (the KPI strip's next free slot and the chips): a partial key matches them all.
      void queryClient.invalidateQueries({
        queryKey: getAvailabilityQueryKey({ path: { dealershipId }, query: { date: day } as GetAvailabilityData["query"] }),
      })
      // Every range read of the dealership (the Overview's fortnight either side of today, the Calendar's week or month).
      void queryClient.invalidateQueries({ queryKey: rangeReadsOf(dealershipId) })
      onBooked(appointment, explanation)
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
          if (stepOneFieldsFor(vehicleAware).includes(path)) onStepOne = true
        }
        if (onStepOne) goTo(1)
        return
      }
      // The switch the dialog read was stale: the API takes no vehicle-aware input now.
      if (slug === "vehicle-aware-requirements-disabled") {
        vehicleRefused("booking")
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

  // A discard took the focused field with it: focus goes to the notice that says why, unless something else holds it (a
  // dialog opened over this one). A layout effect: before the dialog's focus guard puts lost focus on the dialog itself.
  useLayoutEffect(() => {
    if (!discard) return
    const popup = formRef.current?.closest('[role="dialog"]')
    const active = document.activeElement
    if (!active || active === document.body || active === popup) noticeRef.current?.focus()
  }, [discard])

  // The new step's heading takes focus, so keyboard and screen-reader users start at its top (UI_DESIGN 11.14); "Change the
  // vehicle details" from a refusal goes to the vehicle step instead.
  useEffect(() => {
    if (!moved.current) return
    if (focusVehicle.current && vehicleSectionRef.current) {
      focusVehicle.current = false
      vehicleSectionRef.current.focus()
      vehicleSectionRef.current.scrollIntoView?.({ block: "nearest" })
    } else stepHeading.current?.focus()
  }, [step])

  // A refusal comes into view where the user is looking (the step may be scrolled to its last field). When the control that
  // was pressed went with the last one (a suggested start that is now taken too, Try again when the answer is a conflict),
  // focus moves to the new refusal, or to the first field it marked, instead of falling to the dialog. A layout effect: in
  // the same commit as the removal, before the dialog's focus guard puts lost focus on the dialog itself.
  useLayoutEffect(() => {
    if (!failure) return
    problemRef.current?.scrollIntoView?.({ block: "nearest" })
    // A declaration the VIN contradicts needs the advisor's choice, so its alert takes focus wherever focus was.
    const failedProblem = parseProblem(failure)
    if (failedProblem && problemSlug(failedProblem) === "vehicle-profile-conflict" && alertRef.current) {
      alertRef.current.focus()
      return
    }
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
    if (!(await form.trigger(stepOneFieldsFor(vehicleAware) as Array<FieldPath<BookingFormInput>>, { shouldFocus: true }))) return
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

  function submit(event?: FormEvent, choice: { useDecoded?: boolean } = {}) {
    // Bound, before the form's checks run, to the account this dialog was drawn for, and only while the identity in the
    // cache is that account: `/me` may have changed since the last render (Book, Enter in a field, a suggested start).
    // The send checks again once the checks pass, and sends nothing if the booking was discarded meanwhile (this flow
    // unmounted) or the cache names another caller.
    const send = blocked ? null : book.begin()
    if (!send) {
      event?.preventDefault()
      return
    }
    setAnswerDiscarded(false)
    void form.handleSubmit(
      (values) => {
        // Built with the switch as the cache holds it now: nothing of the vehicle step goes to a server that would refuse it.
        // Live HV diagnosis goes only where it applies (the switch is hidden elsewhere, so it is not what the advisor sees).
        const live = values.needsLiveDiagnosis === true && liveDiagnosisApplies(serviceFor(values.serviceTypeId), values.vehicle.profile?.powertrain ?? "Unknown")
        const body = toBookingRequest(
          { ...values, needsLiveDiagnosis: live },
          { vehicleAware: cachedVehicleAware(queryClient), useDecoded: choice.useDecoded ?? useDecoded }
        )
        if (send({ path: { dealershipId }, body, headers: { "Idempotency-Key": idempotencyKey.current } })) lastRequest.current = body
      },
      (errors) => {
        if (stepOneFieldsFor(vehicleAware).some((field) => at(errors, field))) goTo(1)
        // react-hook-form focuses the first invalid field; on a phone it can sit under the sticky footer.
        requestAnimationFrame(() => (document.activeElement as HTMLElement | null)?.scrollIntoView?.({ block: "center" }))
      }
    )(event)
  }

  /**
   * The same request again, with the same key: safe after a lost answer, and replayed (not re-booked) if it had succeeded.
   * Sent only while the cache names the account this dialog was drawn for (`useWriteMutation`).
   */
  function retry() {
    if (!lastRequest.current || book.isPending || blocked) return
    if (book.mutate({ path: { dealershipId }, body: lastRequest.current, headers: { "Idempotency-Key": idempotencyKey.current } })) {
      setAnswerDiscarded(false)
    }
  }

  function bookAt(slot: { startUtc: string }) {
    if (book.isPending) return
    form.setValue("startUtc", slot.startUtc, { shouldValidate: true })
    submit()
  }

  /** "Use decoded data": the advisor books with what the VIN says; the same booking is sent again with `UseDecoded`. */
  function chooseDecoded(resend: boolean) {
    setDecision({ declared: declaredCode, decoded })
    if (resend && !book.isPending) submit(undefined, { useDecoded: true })
  }

  /** "Edit the declaration": back to the manufacturer the advisor declared, the earlier choice undone. */
  function editDeclaration() {
    setDecision(null)
    book.reset()
    if (step !== 2) goTo(2)
    requestAnimationFrame(() => manufacturerRef.current?.focus())
  }

  /** "Change the vehicle details": back to step 1's vehicle step, which takes focus. */
  function changeVehicle() {
    book.reset()
    focusVehicle.current = true
    goTo(1)
  }

  function bookAnother() {
    form.reset(blank(date))
    book.reset()
    resolve.reset()
    setResolved(null)
    setDecision(null)
    setDropped(null)
    setAnswerDiscarded(false)
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
          <BookedState
            appointment={booked}
            timeZone={timeZone}
            explained={vehicleAware && booked.allocation ? { service: serviceFor(booked.serviceType.id), roster: schedule } : null}
            onViewOnBoard={() => onViewOnBoard(booked)}
            onBookAnother={bookAnother}
          />
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
            vehicle={
              vehicleAware || dropped === "availability" || dropped === "switch"
                ? {
                    section: vehicleAware ? <VehicleProfileFields form={form} service={service} sectionRef={vehicleSectionRef} /> : null,
                    availability: availabilityVehicle,
                    dropped: dropped === "availability" || dropped === "switch",
                    onRefused: () => vehicleRefused("availability"),
                  }
                : null
            }
            intake={
              triage.enabled ? (
                <BookingTriageIntake
                  triage={triage}
                  blockedBy={blocked ? blockedId : undefined}
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
            vehicleStep={
              vehicleAware
                ? {
                    summary: { powertrain, vehicleClass, live: liveAsked && liveApplies },
                    vin: <VinField form={form} lookup={lookup} onLookUp={lookUp} blockedBy={blocked ? blockedId : undefined} waiting={lookupWaiting} />,
                    facts: (
                      <VehicleFacts
                        form={form}
                        lookup={lookup}
                        onLookUp={lookUp}
                        decoded={decoded}
                        useDecoded={useDecoded}
                        onUseDecoded={() => chooseDecoded(false)}
                        onEditDeclaration={editDeclaration}
                        manufacturerRef={manufacturerRef}
                      />
                    ),
                  }
                : null
            }
            problem={
              failure && !fieldErrorsOnly(failure) ? (
                <BookingProblem
                  error={failure}
                  alertRef={alertRef}
                  waiting={waiting}
                  busy={book.isPending}
                  booking={book.isPending ? book.variables?.body.startUtc : undefined}
                  vehicle={{
                    declared: declaredCode,
                    decoded,
                    dealershipName: dealership.name,
                    onUseDecoded: () => chooseDecoded(true),
                    onEditDeclaration: editDeclaration,
                    onChangeVehicle: changeVehicle,
                    onBookAgain: () => submit(),
                  }}
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

      {!booked && (blocked || discard) && (
        <SessionNotice
          id={blockedId}
          ref={noticeRef}
          access={access}
          failed={current.status === "failed"}
          retrying={current.fetching}
          onRetry={current.refetch}
          discard={discard}
          sheet={sheet}
        />
      )}
      {!booked && !blocked && answerDiscarded && (
        <div className={cn("border-t px-4 py-3 sm:px-6", sheet && "bg-popover")}>
          <WriteReason
            id={discardedId}
            reason="Who is signed in changed before the answer to Book arrived, so it isn’t shown. Book again to see it: with the same details this booking can’t be made twice."
          />
        </div>
      )}
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
              disabled={book.isPending || waiting > 0 || blocked}
              focusableWhenDisabled
              aria-busy={book.isPending || undefined}
              aria-describedby={blocked ? blockedId : undefined}
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

/** What the session notice says: why the booking was discarded (or cannot be made), and what to do next. */
function sessionNoticeText(access: WriteAccess, failed: boolean, discard: Discard | null): string {
  if (!discard) return access.state === "denied" ? access.reason : "You’re signed out, so this booking can’t be made. Sign in to book."
  const why = failed
    ? "who is signed in couldn’t be checked"
    : access.state === "sign-in"
      ? "you’re signed out"
      : access.state === "denied"
        ? "this account can’t book any more"
        : "another account is signed in"
  const outcome = discard.booked
    ? "This dialog was cleared. The booking had been made: it is on the board."
    : "The booking you were entering was discarded, with its customer, vehicle, description and photos."
  const pending = discard.bookWasPending ? " Book had been pressed, so it may have been booked: check the board before entering it again." : ""
  const next = access.state === "sign-in" ? " Sign in to book." : access.state === "allowed" && !discard.booked ? " Enter it again to book it." : ""
  return `The session changed: ${why}. ${outcome}${pending}${next}`
}

interface SessionNoticeProps {
  id: string
  ref: Ref<HTMLDivElement>
  access: WriteAccess
  /** `/me` could not be read: Try again reads it again. */
  failed: boolean
  retrying: boolean
  onRetry: () => void
  discard: Discard | null
  sheet: boolean
}

/**
 * Above the footer, when the identity changed while the dialog was open: that the booking being entered was discarded
 * because the session changed (and, if Book had been pressed, that it may have been booked), or, with nothing discarded,
 * why it cannot be made; Sign in when signed out, Try again when `/me` could not be read. Book, Suggest a service, its
 * Try again and the photos name it with `aria-describedby` while they are unavailable. It takes focus when the discarded
 * fields took it with them.
 */
function SessionNotice({ id, ref, access, failed, retrying, onRetry, discard, sheet }: SessionNoticeProps) {
  return (
    <div ref={ref} tabIndex={-1} className={cn("flex flex-col gap-2 border-t px-4 py-3 outline-none sm:px-6", sheet && "bg-popover")}>
      <WriteReason id={id} icon={discard ? TriangleAlert : undefined} reason={sessionNoticeText(access, failed, discard)} />
      {(failed || access.state === "sign-in") && (
        <div className="flex flex-wrap gap-2">
          {failed && (
            <Button type="button" size="sm" variant="outline" onClick={onRetry} disabled={retrying} focusableWhenDisabled className="pointer-coarse:h-11">
              <RotateCw aria-hidden="true" className={cn(retrying && "animate-spin")} />
              Try again
            </Button>
          )}
          {access.state === "sign-in" && <SignInAction size="sm" variant="outline" className="pointer-coarse:h-11" />}
        </div>
      )}
    </div>
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
  /**
   * The vehicle step, with vehicle-aware requirements on (ADR-029): its declaration between the service and the starts,
   * which are counted for it; and, once the API refused vehicle-aware inputs or the switch turned off, the note saying
   * they were dropped. `null` otherwise: today's step 1.
   */
  vehicle: {
    section: ReactNode
    availability: AvailabilityVehicle | null
    dropped: boolean
    onRefused: () => void
  } | null
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
  vehicle,
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

      {vehicle?.dropped && <VehicleInputsDropped />}
      {vehicle?.section}

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
              vehicle={vehicle?.availability ?? undefined}
              onVehicleRefused={vehicle?.onRefused}
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
  /**
   * With vehicle-aware requirements on: the vehicle as declared on step 1 (in the summary), the VIN with Look up in place of
   * the plain field, and what the VIN said, under it. `null` otherwise: today's step 2.
   */
  vehicleStep: {
    summary: { powertrain: Powertrain; vehicleClass: VehicleClass; live: boolean }
    vin: ReactNode
    facts: ReactNode
  } | null
}

const ANY = "any"

function StepTwo({
  form,
  headingRef,
  problemRef,
  service,
  schedule,
  startUtc,
  timeZone,
  notesCopied,
  onChangeTime,
  problem,
  vehicleStep,
}: StepTwoProps) {
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
      {service && <Summary service={service} startUtc={startUtc} timeZone={timeZone} onChange={onChangeTime} vehicle={vehicleStep?.summary} />}
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
          {vehicleStep ? (
            <>
              {vehicleStep.vin}
              {vehicleStep.facts}
            </>
          ) : (
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
          )}
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
  vehicle,
}: {
  service: ServiceTypeResponse
  startUtc: string
  timeZone: string
  onChange: () => void
  /** The vehicle as declared on step 1, with where each fact came from (vehicle-aware requirements on). */
  vehicle?: { powertrain: Powertrain; vehicleClass: VehicleClass; live: boolean }
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
        {vehicle && (
          <>
            <dt className="sr-only">Vehicle</dt>
            <dd className="text-sm">
              <DeclaredVehicle powertrain={vehicle.powertrain} vehicleClass={vehicle.vehicleClass} live={vehicle.live} />
            </dd>
          </>
        )}
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

/** A field's error under it, with the field-error icon (UI_DESIGN 11.4). */
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
  /** The vehicle step's answers to its refusals (ADR-029): a conflict's choice, a competence gap, switched-off inputs. */
  vehicle: {
    /** The manufacturer code the advisor declared, if any. */
    declared: string
    /** The manufacturer the VIN decoded, if it was looked up and recognised. */
    decoded: string | null
    dealershipName: string
    onUseDecoded: () => void
    onEditDeclaration: () => void
    onChangeVehicle: () => void
    onBookAgain: () => void
  }
  onPick: (slot: { startUtc: string; startLocal: string }) => void
  onRetry: () => void
  onChangeTime: () => void
  onStartOver: () => void
}

/**
 * Why a booking was refused, in place (UI_DESIGN 11.16): a taken slot with the API's suggested starts, a business rule
 * (with what is missing, or a way back to pick another time), a rate limit with its wait, or a failure with a safe retry.
 * Field errors (`400`) are on their fields; this shows only the ones no field owns.
 */
function BookingProblem({ error, alertRef, waiting, busy, booking, vehicle, onPick, onRetry, onChangeTime, onStartOver }: BookingProblemProps) {
  const problem = parseProblem(error)
  const slug = problem ? problemSlug(problem) : ""
  const status = problem?.status ?? (error instanceof UnexpectedResponseError ? error.status : undefined)

  // Vehicle-aware refusals (ADR-029): a declaration the VIN contradicts, inputs this server does not take now, and a
  // competence gap, each in the advisor's terms.
  if (slug === "vehicle-profile-conflict" && problem) {
    return (
      <ProfileConflictProblem
        problem={problem}
        alertRef={alertRef}
        declared={vehicle.declared}
        decoded={vehicle.decoded}
        busy={busy}
        onUseDecoded={vehicle.onUseDecoded}
        onEditDeclaration={vehicle.onEditDeclaration}
      />
    )
  }
  if (slug === "vehicle-aware-requirements-disabled") {
    return <VehicleInputsDropped alertRef={alertRef} traceId={problem?.traceId} onBookAgain={vehicle.onBookAgain} busy={busy} />
  }
  if (slug === "no-qualified-resources" && problem && typeof problem.minimumHvLevel === "number") {
    return (
      <QualificationGap
        problem={problem}
        alertRef={alertRef}
        dealershipName={vehicle.dealershipName}
        busy={busy}
        onChangeVehicle={vehicle.onChangeVehicle}
        missing={
          <>
            <MissingList label="No bay here has:" names={(problem.missingCapabilities as string[] | undefined) ?? []} />
            <MissingList label="No technician here is certified for:" names={(problem.missingCertifications as string[] | undefined) ?? []} />
          </>
        }
      />
    )
  }

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

  // Signed out or refused for the role: the app's session prompt says what to do (components/auth/session-watch.tsx).
  if (status === 401 || status === 403) {
    return <ProblemAlert tone="warning" title={authRefusalTitle(status, "book")} error={error} focusRef={alertRef} />
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
  explained,
  onViewOnBoard,
  onBookAnother,
}: {
  appointment: AppointmentResponse
  timeZone: string
  /** The allocation's explanation, with vehicle-aware requirements on: the service's needs and the roster for names. */
  explained: { service: ServiceTypeResponse | undefined; roster: WorkshopScheduleResponse | undefined } | null
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
      {explained && appointment.allocation && (
        <AllocationExplanationView
          appointment={appointment}
          allocation={appointment.allocation}
          service={explained.service}
          roster={explained.roster}
          className="mt-3 text-left"
        />
      )}
    </IllustratedState>
  )
}
