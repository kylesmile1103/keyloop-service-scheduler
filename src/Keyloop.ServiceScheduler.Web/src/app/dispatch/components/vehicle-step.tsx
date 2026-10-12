import { CircleAlert, Info, LoaderCircle, LockKeyhole, RotateCw, ScanBarcode, TriangleAlert, Zap } from "lucide-react"
import { type Ref, useId } from "react"
import { Controller, type UseFormReturn, useWatch } from "react-hook-form"

import type { Powertrain, ServiceTypeResponse, VehicleClass, VehicleProfile } from "@/api/types.gen"
import { HvLevelBadge } from "@/components/hv-level"
import { TraceIdRow } from "@/components/problem-alert"
import { ProvenanceChip } from "@/components/provenance-chip"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { featureLabel } from "@/lib/features"
import { describeFailure, type ProblemDetails } from "@/lib/problem-details"
import { cn } from "@/lib/utils"
import {
  attributeLabel,
  hvLevelOf,
  hvLevels,
  LIVE_DIAGNOSIS_RULE,
  liveDiagnosisApplies,
  POWERTRAINS,
  powertrainLabels,
  ruleExplanation,
  VEHICLE_CLASSES,
  vehicleClassLabels,
} from "@/lib/vehicle-aware"

import { type BookingForm, type BookingFormInput, DECLARATION_REASON_LIMIT } from "../lib/booking-schema"

type BookingFormApi = UseFormReturn<BookingFormInput, unknown, BookingForm>

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

const powertrainItems = POWERTRAINS.map((value) => ({ value, label: powertrainLabels[value] }))
const classItems = VEHICLE_CLASSES.map((value) => ({ value, label: vehicleClassLabels[value] }))

/** Each class's consequence, on its option: Unknown is not conservative for the class, so the menu says so. */
const classHints: Record<VehicleClass, string | null> = {
  Unknown: "Adds no heavy-vehicle needs",
  Car: null,
  LightCommercial: null,
  Heavy: "Needs a heavy-duty lift and a heavy-vehicle technician",
}

interface VehicleProfileFieldsProps {
  form: BookingFormApi
  /** The chosen service: whether live HV diagnosis applies depends on it. */
  service: ServiceTypeResponse | undefined
  /** The section's place for focus ("Change the vehicle" from a refusal on step 2). */
  sectionRef?: Ref<HTMLDivElement>
}

/**
 * The vehicle step's declaration (ADR-029), on step 1 beside the service: what the vehicle is decides who may work on it, so
 * it is chosen before a start, and the free starts below are counted for it. Powertrain and class start Unknown; a concrete
 * powertrain asks for a private reason (kept with the booking for audit, never sent to the customer); live HV diagnosis is
 * offered where it applies, with the two-person warning. Part of the booking being entered, discarded with it.
 */
export function VehicleProfileFields({ form, service, sectionRef }: VehicleProfileFieldsProps) {
  const ids = {
    legend: useId(),
    powertrain: useId(),
    vehicleClass: useId(),
    note: useId(),
    reason: useId(),
    reasonHint: useId(),
    reasonCount: useId(),
    reasonError: useId(),
    live: useId(),
    liveHint: useId(),
    liveWarning: useId(),
  }
  const [powertrain = "Unknown", reason = ""] = useWatch({
    control: form.control,
    name: ["vehicle.profile.powertrain", "vehicle.profile.declarationReason"],
  }) as [Powertrain | undefined, string | undefined]
  const declared = powertrain !== "Unknown"
  const liveApplies = liveDiagnosisApplies(service, powertrain)

  return (
    // A group, not a fieldset: its name sits inside the hairline frame, as the suggestions section's does.
    <div
      ref={sectionRef}
      role="group"
      tabIndex={-1}
      aria-labelledby={ids.legend}
      data-slot="vehicle-step"
      className="flex flex-col gap-3 rounded-xl border border-border p-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-4"
    >
      <p id={ids.legend} className="text-sm font-semibold">
        Vehicle
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller
          control={form.control}
          name="vehicle.profile.powertrain"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined} className="gap-1.5">
              <FieldLabel htmlFor={ids.powertrain}>Powertrain</FieldLabel>
              <Select
                items={powertrainItems}
                value={field.value ?? "Unknown"}
                onValueChange={(value) => field.onChange(value ?? "Unknown")}
              >
                <SelectTrigger
                  id={ids.powertrain}
                  ref={field.ref}
                  aria-describedby={!declared ? ids.note : undefined}
                  className="w-full cursor-pointer"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {powertrainItems.map((item) => (
                      <SelectItem key={item.value} value={item.value} className="py-2">
                        <span className="flex min-w-0 flex-col gap-0.5 whitespace-normal">
                          <span className="flex items-center gap-1.5">
                            {/* A high-voltage system, marked; the rest keep the same indent so the names line up. */}
                            {item.value !== "Unknown" && item.value !== "Ice" ? (
                              <Zap aria-hidden="true" className="size-3.5 text-muted-foreground" />
                            ) : (
                              <span aria-hidden="true" className="size-3.5" />
                            )}
                            {item.label}
                          </span>
                          {item.value === "Unknown" && <span className="pl-5 text-xs text-muted-foreground">Planned as high-voltage</span>}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="vehicle.profile.vehicleClass"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined} className="gap-1.5">
              <FieldLabel htmlFor={ids.vehicleClass}>Vehicle class</FieldLabel>
              <Select items={classItems} value={field.value ?? "Unknown"} onValueChange={(value) => field.onChange(value ?? "Unknown")}>
                <SelectTrigger id={ids.vehicleClass} ref={field.ref} className="w-full cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {classItems.map((item) => (
                      <SelectItem key={item.value} value={item.value} className="py-2">
                        <span className="flex min-w-0 flex-col gap-0.5 whitespace-normal">
                          <span>{item.label}</span>
                          {classHints[item.value] && <span className="text-xs text-muted-foreground">{classHints[item.value]}</span>}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}
        />
      </div>

      {declared ? (
        <Controller
          control={form.control}
          name="vehicle.profile.declarationReason"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined} className="gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldLabel htmlFor={ids.reason}>Why you’re declaring it</FieldLabel>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <LockKeyhole aria-hidden="true" className="size-3.5" />
                  Private
                </span>
              </div>
              <Textarea
                id={ids.reason}
                {...field}
                value={field.value ?? ""}
                rows={2}
                maxLength={DECLARATION_REASON_LIMIT}
                autoComplete="off"
                aria-invalid={fieldState.invalid || undefined}
                aria-describedby={[fieldState.error ? ids.reasonError : null, ids.reasonHint, ids.reasonCount].filter(Boolean).join(" ")}
                placeholder="For example: the customer confirmed a diesel engine on the phone"
                className="min-h-16 scroll-mt-24 scroll-mb-28"
              />
              <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
                <p id={ids.reasonHint}>Kept with the booking for audit, never sent to the customer.</p>
                <p id={ids.reasonCount} className="shrink-0 tabular-nums">
                  <span aria-hidden="true">{`${reason.length}/${DECLARATION_REASON_LIMIT}`}</span>
                  <span className="sr-only">{`${reason.length} of ${DECLARATION_REASON_LIMIT} characters`}</span>
                </p>
              </div>
              <FormError id={ids.reasonError} message={fieldState.error?.message} />
            </Field>
          )}
        />
      ) : (
        <p id={ids.note} className="flex items-start gap-2 text-xs text-pretty text-muted-foreground">
          <Info aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span>
            Until the powertrain is declared, the job is planned as if the vehicle were high-voltage: only HV-trained technicians
            count, so fewer starts may be free, never an unsafe one.
          </span>
        </p>
      )}

      {liveApplies && (
        <Controller
          control={form.control}
          name="needsLiveDiagnosis"
          render={({ field }) => (
            <div className="flex flex-col gap-2 border-t pt-3">
              <div className="flex items-start gap-3">
                <Switch
                  id={ids.live}
                  checked={field.value === true}
                  onCheckedChange={(checked) => field.onChange(checked)}
                  aria-describedby={[ids.liveHint, field.value ? ids.liveWarning : null].filter(Boolean).join(" ")}
                  className="mt-1"
                />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Label htmlFor={ids.live} className="cursor-pointer pointer-coarse:min-h-11 pointer-coarse:items-center">
                    Needs live HV diagnosis
                  </Label>
                  <p id={ids.liveHint} className="text-xs text-pretty text-muted-foreground">
                    Working on the high-voltage system while it is live: needs an HV level 4 technician and an EV bay.
                  </p>
                </div>
              </div>
              {field.value && <TwoPersonWarning id={ids.liveWarning} />}
            </div>
          )}
        />
      )}
    </div>
  )
}

/** ADR-029's known limitation, said wherever live HV working is booked or shown. */
export function TwoPersonWarning({ id, className }: { id?: string; className?: string }) {
  return (
    <p
      id={id}
      className={cn(
        "flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-subtle px-3 py-2 text-sm text-pretty text-foreground",
        className
      )}
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
      <span>Live working needs two trained people present. The booking reserves one technician: arrange the second person too.</span>
    </p>
  )
}

/**
 * The vehicle as declared, for step 2's summary: a declared fact with its provenance chip, a fact nobody declared said
 * plainly in the muted ink (Unknown powertrain with what it means for the job).
 */
export function DeclaredVehicle({ powertrain, vehicleClass, live }: { powertrain: Powertrain; vehicleClass: VehicleClass; live: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {powertrain === "Unknown" ? (
        <span className="text-muted-foreground">Powertrain not known, planned as high-voltage</span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          {powertrainLabels[powertrain]}
          <ProvenanceChip source="Declared" />
        </span>
      )}
      {vehicleClass === "Unknown" ? (
        <span className="text-muted-foreground">Class not known</span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          {vehicleClassLabels[vehicleClass]}
          <ProvenanceChip source="Declared" />
        </span>
      )}
      {live && (
        <Badge variant="outline" className="font-normal">
          <Zap aria-hidden="true" />
          Live HV diagnosis
        </Badge>
      )}
    </span>
  )
}

/** The VIN look-up's state, as step 2 shows it. */
export type Lookup =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "done"; profile: VehicleProfile }
  | { state: "failed"; error: unknown }

interface VinFieldProps {
  form: BookingFormApi
  lookup: Lookup
  /** Look the VIN up: from the button, or when the field is left with a whole VIN (skipped when it was looked up already). */
  onLookUp: (trigger: "button" | "blur") => void
  /** The id of the reason this account cannot look up (signed out, a role that cannot book), or none. */
  blockedBy?: string
  /** A rate limit's wait, in seconds. */
  waiting: number
}

/**
 * The VIN, as today, with "Look up" (also run when the field is left with 17 valid characters): the VIN goes to
 * `POST /vehicle-profiles/resolve` in the request body only. The API decodes the manufacturer from the VIN's first three
 * characters when it knows them; the powertrain and the class are not in a VIN, and the panel says so plainly.
 */
export function VinField({ form, lookup, onLookUp, blockedBy, waiting }: VinFieldProps) {
  const id = useId()
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`
  const pending = lookup.state === "pending"
  return (
    <Controller
      control={form.control}
      name="vehicle.vin"
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined} className="gap-1.5 sm:col-span-6">
          <FieldLabel htmlFor={id}>VIN</FieldLabel>
          <div className="flex gap-2">
            <Input
              id={id}
              {...field}
              onChange={(event) => field.onChange(event.target.value.toUpperCase())}
              onBlur={() => {
                field.onBlur()
                if (/^[A-HJ-NPR-Z0-9]{17}$/.test(field.value.trim().toUpperCase())) onLookUp("blur")
              }}
              autoCapitalize="characters"
              spellCheck={false}
              autoComplete="off"
              maxLength={17}
              aria-invalid={fieldState.invalid || undefined}
              aria-describedby={[fieldState.error ? errorId : null, descriptionId].filter(Boolean).join(" ")}
              className="scroll-mt-24 scroll-mb-28 font-mono tracking-wide uppercase"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => onLookUp("button")}
              disabled={pending || waiting > 0 || Boolean(blockedBy)}
              focusableWhenDisabled
              aria-busy={pending || undefined}
              aria-describedby={blockedBy}
              className="shrink-0 pointer-coarse:h-11"
            >
              {pending ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <ScanBarcode aria-hidden="true" />}
              {waiting > 0 ? `Look up (in ${waiting} s)` : "Look up"}
            </Button>
          </div>
          {!fieldState.error && (
            <p id={descriptionId} className="text-xs text-muted-foreground">
              17 characters, no I, O or Q. Look up reads the manufacturer from it.
            </p>
          )}
          <FormError id={errorId} message={fieldState.error?.message} />
        </Field>
      )}
    />
  )
}

interface VehicleFactsProps {
  form: BookingFormApi
  lookup: Lookup
  onLookUp: (trigger: "button" | "blur") => void
  /** The manufacturer the VIN decoded, when it did. */
  decoded: string | null
  /** The advisor chose the decoded manufacturer over their declaration. */
  useDecoded: boolean
  onUseDecoded: () => void
  onEditDeclaration: () => void
  manufacturerRef: Ref<HTMLInputElement>
}

/**
 * What the VIN said, under the VIN: the manufacturer with its provenance chip ("from VIN"), or that the VIN was not
 * recognised, and a declared manufacturer code only while the VIN does not decide it. A declaration that disagrees with
 * the decoded manufacturer is shown before Book, with the two ways on: use the decoded data, or edit the declaration.
 */
export function VehicleFacts({ form, lookup, onLookUp, decoded, useDecoded, onUseDecoded, onEditDeclaration, manufacturerRef }: VehicleFactsProps) {
  const ids = { input: useId(), hint: useId(), error: useId(), conflict: useId() }
  const declared = (useWatch({ control: form.control, name: "vehicle.profile.manufacturer" }) ?? "").trim().toUpperCase()
  const conflict = decoded !== null && declared !== "" && declared !== decoded
  const showDeclaration = decoded === null || declared !== ""

  return (
    <div
      data-slot="vehicle-facts"
      aria-live="polite"
      // A hairline as well as the fill: in the dark theme the muted fill alone barely parts from the dialog's surface.
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm sm:col-span-6"
    >
      <dl className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
        <dt className="text-muted-foreground">Manufacturer</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
          {lookup.state === "pending" ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
              Reading the VIN…
            </span>
          ) : lookup.state === "done" && decoded ? (
            <>
              <span className="font-mono text-xs font-medium tracking-wide">{decoded}</span>
              <ProvenanceChip source={lookup.profile.provenance.manufacturer} />
            </>
          ) : lookup.state === "done" ? (
            <>
              <span>Not recognised from the VIN</span>
              <ProvenanceChip source="Unknown" />
            </>
          ) : lookup.state === "failed" ? (
            <span className="flex flex-wrap items-center gap-2 text-destructive">
              <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0">{`Couldn’t read the VIN. ${describeFailure(lookup.error).summary}`}</span>
              <Button type="button" variant="link" className="h-auto px-0" onClick={() => onLookUp("button")}>
                <RotateCw aria-hidden="true" />
                Try again
              </Button>
            </span>
          ) : (
            <span className="text-muted-foreground">Look up the VIN to read it.</span>
          )}
        </dd>
      </dl>
      {lookup.state === "done" && (
        <p className="text-xs text-pretty text-muted-foreground">
          A VIN doesn’t record the powertrain or the class: they stay as declared on step 1.
        </p>
      )}

      {showDeclaration && (
        <Controller
          control={form.control}
          name="vehicle.profile.manufacturer"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined} className="gap-1.5">
              <FieldLabel htmlFor={ids.input}>Manufacturer code (optional)</FieldLabel>
              <Input
                id={ids.input}
                {...field}
                ref={(element) => {
                  field.ref(element)
                  if (typeof manufacturerRef === "function") manufacturerRef(element)
                  else if (manufacturerRef) manufacturerRef.current = element
                }}
                value={field.value ?? ""}
                onChange={(event) => field.onChange(event.target.value.toUpperCase())}
                autoCapitalize="characters"
                spellCheck={false}
                autoComplete="off"
                maxLength={32}
                placeholder="For example BMW"
                aria-invalid={fieldState.invalid || undefined}
                aria-describedby={[fieldState.error ? ids.error : null, conflict ? ids.conflict : ids.hint].filter(Boolean).join(" ")}
                className="max-w-64 bg-background font-mono tracking-wide uppercase placeholder:font-sans placeholder:tracking-normal placeholder:normal-case"
              />
              {!fieldState.error && !conflict && (
                <p id={ids.hint} className="text-xs text-muted-foreground">
                  Only when the VIN isn’t recognised: a recognised VIN decides the manufacturer.
                </p>
              )}
              <FormError id={ids.error} message={fieldState.error?.message} />
            </Field>
          )}
        />
      )}

      {conflict && (
        <ManufacturerConflict
          id={ids.conflict}
          declared={declared}
          decoded={decoded}
          useDecoded={useDecoded}
          onUseDecoded={onUseDecoded}
          onEditDeclaration={onEditDeclaration}
        />
      )}
    </div>
  )
}

interface ManufacturerConflictProps {
  id?: string
  declared: string
  decoded: string
  useDecoded: boolean
  onUseDecoded: () => void
  onEditDeclaration: () => void
}

/** A declared manufacturer the VIN contradicts, caught before Book: the VIN is the stronger evidence, and the advisor decides. */
function ManufacturerConflict({ id, declared, decoded, useDecoded, onUseDecoded, onEditDeclaration }: ManufacturerConflictProps) {
  return (
    <div
      id={id}
      className={cn(
        "flex flex-col gap-2 rounded-lg border px-3 py-2",
        useDecoded ? "border-border bg-background" : "border-warning/30 bg-warning-subtle"
      )}
    >
      <p className="flex items-start gap-2 text-sm text-pretty">
        {useDecoded ? (
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        ) : (
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
        )}
        <span>
          {useDecoded
            ? `Booking uses ${decoded} from the VIN; the declared ${declared} is set aside.`
            : `The VIN says ${decoded}, but ${declared} is declared. The VIN is the stronger evidence.`}
        </span>
      </p>
      <span className="flex flex-wrap gap-2 pl-6">
        {!useDecoded && (
          <Button type="button" variant="signal" size="sm" onClick={onUseDecoded} className="pointer-coarse:h-11">
            Use decoded data
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={onEditDeclaration} className="bg-background pointer-coarse:h-11">
          Edit the declaration
        </Button>
      </span>
    </div>
  )
}

/** A problem's extension members the vehicle-aware refusals carry. */
const listOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])

interface ProfileConflictProblemProps {
  problem: ProblemDetails
  alertRef: Ref<HTMLDivElement>
  declared: string
  decoded: string | null
  busy: boolean
  onUseDecoded: () => void
  onEditDeclaration: () => void
}

/**
 * `422 vehicle-profile-conflict`: the declaration disagrees with what the VIN decodes, and the advisor has not chosen. Names
 * the conflicting attributes with both values where the dialog knows them (the problem never echoes them), and offers
 * "Use decoded data" (the same booking again, with `conflictChoice: UseDecoded`) or editing the declaration. It takes focus.
 */
export function ProfileConflictProblem({ problem, alertRef, declared, decoded, busy, onUseDecoded, onEditDeclaration }: ProfileConflictProblemProps) {
  const attributes = listOf(problem.conflictingAttributes)
  return (
    <Alert
      ref={alertRef}
      tabIndex={-1}
      data-tone="warning"
      className="border-warning/30 bg-warning-subtle px-4 py-3 text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 *:[svg]:text-warning"
    >
      <TriangleAlert aria-hidden="true" />
      <AlertTitle className="font-semibold text-warning">The declared vehicle doesn’t match its VIN</AlertTitle>
      <AlertDescription className="flex flex-col gap-2 text-foreground">
        <ul className="flex flex-col gap-1">
          {(attributes.length > 0 ? attributes : ["manufacturer"]).map((attribute) => (
            <li key={attribute}>
              {attribute === "manufacturer" && declared
                ? `${attributeLabel(attribute)}: declared ${declared}, the VIN says ${decoded ?? "otherwise"}.`
                : `${attributeLabel(attribute)}: the declaration and the VIN disagree.`}
            </li>
          ))}
        </ul>
        <span>Book with the VIN’s data, or correct the declaration.</span>
        {problem.traceId && <TraceIdRow traceId={problem.traceId} />}
        <span className="flex flex-wrap items-center gap-2 pt-1">
          <Button type="button" variant="signal" size="sm" onClick={onUseDecoded} disabled={busy} focusableWhenDisabled>
            Use decoded data
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onEditDeclaration} disabled={busy} className="bg-background">
            Edit the declaration
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  )
}

interface QualificationGapProps {
  problem: ProblemDetails
  alertRef: Ref<HTMLDivElement>
  dealershipName: string
  busy: boolean
  onChangeVehicle: () => void
}

/** The title for what the refusal names missing: bays, technicians, both, or neither. */
function gapTitle(bays: boolean, technicians: boolean): string {
  if (bays && technicians) return "No bay here is equipped, and no technician certified, for this job"
  if (bays) return "No bay here is equipped for this job"
  if (technicians) return "No technician here is certified for this job"
  return "No bay and technician here meet this job’s needs"
}

/** One side of what the refusal names missing, as outline badges after its label. */
function MissingResources({ label, names }: { label: string; names: readonly string[] }) {
  if (names.length === 0) return null
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span>{label}</span>
      {names.map((name) => (
        <Badge key={name} variant="outline" className="bg-background">
          {featureLabel(name)}
        </Badge>
      ))}
    </span>
  )
}

/**
 * `422 no-qualified-resources` with the vehicle-aware members, saying exactly what the API established and no more
 * (`BookAppointmentHandler`). `missingCapabilities` lists what no active bay has and `missingCertifications` what no active
 * technician holds. A list is empty when its side qualifies, but also when each of its needs is held somewhere yet by no one
 * bay or technician, and the technicians' list is empty when only their HV level falls short. `minimumHvLevel` is what the
 * job needs, never a shortfall. So a side is named only when its list is not empty, and nothing is said of the other; with
 * both empty, the alert says every need is held here but not all together, by a bay or by a technician, without choosing.
 * It reads as information, in neutral words: what the job needs, why (the rules), what is missing, and what to do next.
 */
export function QualificationGap({ problem, alertRef, dealershipName, busy, onChangeVehicle }: QualificationGapProps) {
  const level = hvLevelOf(typeof problem.minimumHvLevel === "number" ? problem.minimumHvLevel : null)
  const rules = listOf(problem.firedRules)
  const live = rules.includes(LIVE_DIAGNOSIS_RULE)
  const missing = { capabilities: listOf(problem.missingCapabilities), certifications: listOf(problem.missingCertifications) }
  const named = missing.capabilities.length > 0 || missing.certifications.length > 0
  const title = gapTitle(missing.capabilities.length > 0, missing.certifications.length > 0)
  return (
    <Alert
      ref={alertRef}
      tabIndex={-1}
      data-tone="info"
      className="border-info/30 bg-info-subtle px-4 py-3 text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 *:[svg]:text-info"
    >
      <Info aria-hidden="true" />
      <AlertTitle className="font-semibold text-info">{title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2 text-foreground">
        {level !== null && level > 0 && (
          <span className="flex flex-wrap items-center gap-2">
            <span>This job needs</span>
            <HvLevelBadge level={level} named />
            <span className="sr-only">{hvLevels[level].description}</span>
          </span>
        )}
        {rules.length > 0 && (
          <span className="flex flex-col gap-1">
            <span>Because:</span>
            <ul className="list-disc pl-5">
              {rules.map((rule) => (
                <li key={rule}>{ruleExplanation(rule)}</li>
              ))}
            </ul>
          </span>
        )}
        <MissingResources label="No active bay here has:" names={missing.capabilities} />
        <MissingResources label="No active technician here holds:" names={missing.certifications} />
        {!named && (
          <span className="text-pretty">
            {`Each capability and certification it needs is held at ${dealershipName}, but no single active bay has every capability, or no single active technician has every certification${level !== null && level > 0 ? ` and HV level ${level} or above, valid on the day` : ""}.`}
          </span>
        )}
        <span className="text-pretty">
          {live
            ? "If the work can be done with the system switched off, turn off live HV diagnosis and choose a start again."
            : "Check the vehicle details, which decide what this job needs, or book it at another dealership."}
        </span>
        {problem.traceId && <TraceIdRow traceId={problem.traceId} />}
        <span className="flex flex-wrap items-center gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onChangeVehicle} disabled={busy} className="bg-background">
            Change the vehicle details
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  )
}

interface VehicleInputsDroppedProps {
  alertRef?: Ref<HTMLDivElement>
  /** The refused request's trace id, when the refusal came from Book. */
  traceId?: string
  /** "Book again" sends the booking without them; none when the refusal came from a read. */
  onBookAgain?: () => void
  busy?: boolean
}

/**
 * `422 vehicle-aware-requirements-disabled` (or the switch turning off while a declaration was entered): this server does
 * not take vehicle-aware inputs now, so they were dropped and the switch is read again. Said once, plainly: the booking
 * now uses the service's standard requirements.
 */
export function VehicleInputsDropped({ alertRef, traceId, onBookAgain, busy = false }: VehicleInputsDroppedProps) {
  return (
    <Alert
      ref={alertRef}
      tabIndex={alertRef ? -1 : undefined}
      data-tone="info"
      className="border-info/30 bg-info-subtle px-4 py-3 text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 *:[svg]:text-info"
    >
      <Info aria-hidden="true" />
      <AlertTitle className="font-semibold text-info">Vehicle details aren’t used here now</AlertTitle>
      <AlertDescription className="flex flex-col gap-2 text-foreground">
        <span className="text-pretty">
          This server has vehicle-aware requirements turned off, so the powertrain, class and live-diagnosis choice were dropped.
          The booking now uses the service’s standard requirements.
        </span>
        {traceId && <TraceIdRow traceId={traceId} />}
        {onBookAgain && (
          <span className="flex flex-wrap items-center gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onBookAgain} disabled={busy} focusableWhenDisabled className="bg-background">
              Book again
            </Button>
          </span>
        )}
      </AlertDescription>
    </Alert>
  )
}
