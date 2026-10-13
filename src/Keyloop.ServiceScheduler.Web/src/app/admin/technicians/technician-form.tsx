import { useDataProvider, useForm as useRefineForm } from "@refinedev/core"
import { LoaderCircle, Plus, X } from "lucide-react"
import { type KeyboardEvent, type RefObject, useId, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { Controller, type FieldErrors, type Resolver, useForm, useWatch } from "react-hook-form"

import type { AdminTechnicianResponse, Certification, DealershipResponse, TechnicianWriteRequest } from "@/api/types.gen"
import { ProblemAlert } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useWriteMutation } from "@/hooks/use-write-mutation"
import { formatDay, isCalendarDate, shiftDate } from "@/lib/calendar-date"
import { certifications } from "@/lib/features"
import { fieldErrors, parseProblem, problemSlug } from "@/lib/problem-details"
import { type HvLevel, hvLevelOf } from "@/lib/vehicle-aware"

import { ConflictPanel } from "../components/conflict-panel"
import { EditSheet } from "../components/edit-sheet"
import { FailureAlert, FieldMessage } from "../components/form-parts"
import { UpcomingWork } from "../components/upcoming-work"
import { type Conflict, conflictOf, resourceTag } from "../lib/admin-api"
import { conflictRows, reapplied, technicianFields, technicianWrite } from "../lib/changes"
import { type SchedulerHttpError, shownFailure } from "../lib/http-error"
import { HvLevelField } from "./hv-level-field"

/** What the sheet edits: a new technician, or one of the roster by id (its name titles the sheet). */
export type TechnicianEditing = { mode: "create" } | { mode: "edit"; id: string; name: string }

/** The certifications in the order the API lists them. */
const CERTIFICATIONS = Object.keys(certifications) as Certification[]

const BRAND = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/
const BRAND_RULE = "Use letters, digits and hyphens, starting with a letter or digit, up to 32 characters."
const MAX_BRANDS = 16

/** The form's values: the write state, with the expiry as a date field and a "Does not expire" box. */
interface TechnicianFormValues {
  name: string
  employeeNumber: string
  certifications: Certification[]
  isActive: boolean
  hvLevel: number
  doesNotExpire: boolean
  hvLevelValidUntil: string
  hvLevelConfirmed: boolean
  brandSpecialisms: string[]
}

/**
 * The form's checks, the API's own (`TechnicianWriteValidator`) in the screen's words, before anything is sent. Written out
 * rather than a zod schema: zod's checks live in a chunk the dispatch board shares, and every one used here would join the
 * board's first load.
 */
const resolver: Resolver<TechnicianFormValues> = async (values) => {
  const errors: FieldErrors<TechnicianFormValues> = {}
  const fail = (field: keyof TechnicianFormValues, message: string) => (errors[field] = { type: "validate", message })
  const name = values.name.trim()
  if (!name) fail("name", "Enter the technician's name.")
  else if (name.length > 120) fail("name", "Keep the name to 120 characters.")
  const number = values.employeeNumber.trim()
  if (!number) fail("employeeNumber", "Enter the employee number.")
  else if (number.length > 32) fail("employeeNumber", "Keep the employee number to 32 characters.")
  if (!values.doesNotExpire && !isCalendarDate(values.hvLevelValidUntil)) {
    fail("hvLevelValidUntil", "Enter the last day the level counts, or choose Does not expire.")
  }
  if (values.brandSpecialisms.length > MAX_BRANDS) fail("brandSpecialisms", `Keep to ${MAX_BRANDS} brands.`)
  else if (values.brandSpecialisms.some((brand) => !BRAND.test(brand))) fail("brandSpecialisms", BRAND_RULE)
  return Object.keys(errors).length > 0 ? { values: {}, errors } : { values, errors: {} }
}

/** The form's values for a state (a new technician starts active, with no HV training, confirmed, no brands). */
function valuesOf(state: TechnicianWriteRequest | null): TechnicianFormValues {
  return {
    name: state?.name ?? "",
    employeeNumber: state?.employeeNumber ?? "",
    certifications: state ? [...state.certifications] : [],
    isActive: state?.isActive ?? true,
    hvLevel: state?.hvLevel ?? 0,
    doesNotExpire: !state?.hvLevelValidUntil,
    hvLevelValidUntil: state?.hvLevelValidUntil ?? "",
    hvLevelConfirmed: state?.hvLevelConfirmed ?? true,
    brandSpecialisms: state ? [...state.brandSpecialisms] : [],
  }
}

/** The request body for the form's values: the whole state, names trimmed, the certifications in the API's order. */
function bodyOf(values: TechnicianFormValues): TechnicianWriteRequest {
  return {
    name: values.name.trim(),
    employeeNumber: values.employeeNumber.trim(),
    certifications: CERTIFICATIONS.filter((certification) => values.certifications.includes(certification)),
    isActive: values.isActive,
    hvLevel: values.hvLevel,
    hvLevelValidUntil: values.doesNotExpire ? null : values.hvLevelValidUntil,
    hvLevelConfirmed: values.hvLevelConfirmed,
    brandSpecialisms: values.brandSpecialisms,
  }
}

/** The form's labels for the API's field paths, so a 400's sentence names the field as the screen does. */
const LABELS: Record<string, string> = {
  name: "Name",
  employeeNumber: "Employee number",
  certifications: "Certified for",
  hvLevel: "HV level",
  hvLevelValidUntil: "Valid until",
  brandSpecialisms: "Brand specialisms",
}

interface TechnicianSheetProps {
  editing: TechnicianEditing | null
  open: boolean
  onOpenChange: (open: boolean) => void
  dealership: DealershipResponse
  today: string
  phone: boolean
  /** Vehicle-aware requirements on: the competence block shows (with it off the record's competence is kept as it is). */
  vehicleAware: boolean
  returnFocus: () => HTMLElement | null
  onSaved: (saved: AdminTechnicianResponse, editing: TechnicianEditing) => void
  /** A conflict's Discard: the sheet closes and the list is read again. */
  onDiscarded: () => void
}

/**
 * Adding or editing a technician (Task 30b, UI_DESIGN 11.24), in the edit sheet. The record is read through Refine core's
 * `useForm` (its `useOne`, the data provider's fresh Admin read), once, when the sheet opens; the form is react-hook-form
 * with the app's own checks (not zod) and fields. Saving sends the whole state through the data provider's `update` (or `create`), as a
 * write bound to the Admin who opened the form (`useWriteMutation` with `writes: "admin"`), with the version it was read at.
 * Refine's own `onFinish` is not used: its mutation would leave outside that binding.
 */
export function TechnicianSheet({ editing, open, onOpenChange, dealership, today, phone, vehicleAware, returnFocus, onSaved, onDiscarded }: TechnicianSheetProps) {
  const firstField = useRef<HTMLInputElement>(null)
  const title = editing?.mode === "edit" ? `Edit ${editing.name}` : "Add technician"
  return (
    <EditSheet
      open={open && editing !== null}
      onOpenChange={onOpenChange}
      phone={phone}
      title={title}
      description="Changes apply to new bookings. Appointments already booked keep their technician; the board flags any that no longer qualify."
      initialFocus={firstField}
      returnFocus={returnFocus}
    >
      {editing && (
        <TechnicianSheetBody
          key={editing.mode === "edit" ? editing.id : "create"}
          editing={editing}
          dealership={dealership}
          today={today}
          vehicleAware={vehicleAware}
          firstFieldRef={firstField}
          onCancel={() => onOpenChange(false)}
          onSaved={(saved) => onSaved(saved, editing)}
          onDiscarded={onDiscarded}
        />
      )}
    </EditSheet>
  )
}

interface BodyProps {
  editing: TechnicianEditing
  dealership: DealershipResponse
  today: string
  vehicleAware: boolean
  firstFieldRef: RefObject<HTMLInputElement | null>
  onCancel: () => void
  onSaved: (saved: AdminTechnicianResponse) => void
  onDiscarded: () => void
}

/** The record the form edits: read once, with Refine's `useForm`, before the form is drawn from it. */
function TechnicianSheetBody(props: BodyProps) {
  const { editing, dealership, today } = props
  const { query } = useRefineForm<AdminTechnicianResponse, SchedulerHttpError>({
    resource: "technicians",
    action: editing.mode === "edit" ? "edit" : "create",
    id: editing.mode === "edit" ? editing.id : undefined,
    meta: { dealershipId: dealership.id, date: today, view: "admin" },
    redirect: false,
    // The representation the edit is made from: read when the sheet opens, never replaced under the form (a later save
    // by someone else is a 412 to resolve, not a silent rebase).
    queryOptions: { enabled: editing.mode === "edit", refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false, staleTime: Infinity, gcTime: 0 },
  })
  // The record as first read, kept: a re-read (the cache cleared for a change of role of the same Admin, or Reload after a
  // 428) never rebases the form under what the Admin entered; the form decides what a Reload's fresh read means.
  const [kept, setKept] = useState<AdminTechnicianResponse | null>(null)
  if (!kept && query?.data?.data) setKept(query.data.data)

  if (editing.mode === "create") return <TechnicianFormBody {...props} base={null} />
  const record = kept ?? query?.data?.data
  if (!record) {
    if (query?.error) {
      return (
        <div className="flex-1 overflow-y-auto p-4">
          <ProblemAlert
            title="Couldn’t load the technician"
            error={shownFailure(query.error)}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        </div>
      )
    }
    return <FormSkeleton />
  }
  return (
    <TechnicianFormBody
      {...props}
      base={record}
      onReload={async () => {
        // A failed read keeps the last data it had: only a successful one is the record as it is now.
        const read = await query?.refetch()
        return read && !read.isError ? (read.data?.data ?? null) : null
      }}
    />
  )
}

function FormSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-5 p-4" aria-busy="true">
      <p role="status" className="sr-only">
        Loading the technician…
      </p>
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  )
}

interface FormBodyProps extends BodyProps {
  /** The Admin representation the form was opened with; `null` for a new technician. */
  base: AdminTechnicianResponse | null
  /** Reads the record again (after a 428): the record as it is now, or `null` when the read failed. */
  onReload?: () => Promise<AdminTechnicianResponse | null>
}

type SaveVariables = { body: TechnicianWriteRequest; ifMatch?: string }

function TechnicianFormBody({ editing, dealership, today, vehicleAware, firstFieldRef, base: opened, onCancel, onSaved, onDiscarded, onReload }: FormBodyProps) {
  const ids = {
    name: useId(),
    nameError: useId(),
    number: useId(),
    numberError: useId(),
    level: useId(),
    validUntil: useId(),
    validUntilHelp: useId(),
    validUntilError: useId(),
    confirmed: useId(),
    confirmedHelp: useId(),
    brand: useId(),
    brandHelp: useId(),
    brandError: useId(),
    active: useId(),
    activeHelp: useId(),
  }
  const dataProvider = useDataProvider()
  // The representation edited: the one read when the sheet opened, then the current one once a conflict is reapplied.
  const [base, setBase] = useState(opened)
  const [conflict, setConflict] = useState<(Conflict<AdminTechnicianResponse> & { mine: TechnicianWriteRequest }) | null>(null)
  const [reappliedNote, setReappliedNote] = useState(false)
  const [reloaded, setReloaded] = useState<"kept" | "failed" | null>(null)
  const [reloading, setReloading] = useState(false)
  const [brandDraft, setBrandDraft] = useState("")
  const [brandError, setBrandError] = useState<string | null>(null)
  const conflictRef = useRef<HTMLElement>(null)
  const saveRef = useRef<HTMLButtonElement>(null)

  const form = useForm<TechnicianFormValues>({ defaultValues: valuesOf(opened ? technicianWrite(opened) : null), resolver })
  const values = useWatch({ control: form.control })
  const { errors } = form.formState
  const nameField = form.register("name")

  const save = useWriteMutation<AdminTechnicianResponse, SchedulerHttpError, SaveVariables>({
    writes: "admin",
    mutationFn: async ({ body, ifMatch }: SaveVariables, write) => {
      const provider = dataProvider()
      const meta = { dealershipId: dealership.id, fetch: write.fetch(), ifMatch }
      const answer =
        editing.mode === "edit"
          ? await provider.update({ resource: "technicians", id: editing.id, variables: body, meta })
          : await provider.create({ resource: "technicians", variables: body, meta })
      return answer.data as unknown as AdminTechnicianResponse
    },
    onSuccess: (saved) => onSaved(saved),
    onError: (error, variables) => {
      const failure = shownFailure(error)
      const stale = conflictOf<AdminTechnicianResponse>(failure)
      if (stale) {
        setConflict({ ...stale, mine: variables.body })
        // The Save that was pressed is no longer the next step: the comparison is.
        requestAnimationFrame(() => conflictRef.current?.focus())
        return
      }
      const problem = parseProblem(failure)
      if (problem && problemSlug(problem) === "validation-error") {
        const fields = fieldErrors(problem, LABELS)
        let first = true
        for (const [path, message] of Object.entries(fields)) {
          const name = (path.startsWith("brandSpecialisms") ? "brandSpecialisms" : path) as keyof TechnicianFormValues
          if (name in LABELS) {
            form.setError(name, { type: "server", message }, { shouldFocus: first })
            first = false
          }
        }
      }
    },
  })

  const failure = save.error ? shownFailure(save.error) : null
  const problem = parseProblem(failure)
  const fieldRefusal = problem !== null && problemSlug(problem) === "validation-error" && Object.keys(problem.errors ?? {}).some((path) => path.split(/[.[]/)[0] in LABELS)
  const showFailure = failure !== null && conflict === null && !fieldRefusal

  const submit = () => {
    // Bound before the checks run, to the Admin the form was drawn for (ARCHITECTURE §15).
    const send = save.begin()
    if (!send) return
    setReappliedNote(false)
    setReloaded(null)
    void form.handleSubmit((checked) => {
      setConflict(null)
      send({ body: bodyOf(checked), ifMatch: base ? resourceTag(base.version) : undefined })
    })()
  }

  const reapply = () => {
    if (!conflict || !base) return
    const merged = reapplied(technicianFields, technicianWrite(base), technicianWrite(conflict.current), conflict.mine)
    setBase(conflict.current)
    form.reset(valuesOf(merged))
    setConflict(null)
    setReappliedNote(true)
    save.reset()
    requestAnimationFrame(() => saveRef.current?.focus())
  }

  // Reload after a 428 keeps what the Admin entered (Codex check of Task 30b): read the record again; unchanged since the
  // form opened, the values stay for another Save with that version; changed, the comparison (opened, now, yours) opens to
  // reapply them, as after a 412. Nothing entered is dropped without the Admin's Discard.
  const reload = async () => {
    if (!onReload || !base) return
    const mine = bodyOf(form.getValues())
    setReloading(true)
    const current = await onReload()
    setReloading(false)
    if (!current) return setReloaded("failed")
    // Focus leaves Reload before the alert holding it goes: a focused element removed from the sheet sends focus to the
    // sheet itself (Base UI restores it to the popup on the next frame, after anything this form asked for).
    saveRef.current?.focus()
    save.reset()
    if (current.version === base.version) {
      setBase(current)
      setReloaded("kept")
      return
    }
    // The comparison is drawn at once and then focused: a frame's wait can come before React commits it.
    flushSync(() => {
      setReloaded(null)
      setConflict({ current, currentETag: resourceTag(current.version), mine })
    })
    conflictRef.current?.focus()
  }

  const addBrand = () => {
    const code = brandDraft.trim().toUpperCase()
    if (!code) return
    if (!BRAND.test(code)) return setBrandError(BRAND_RULE)
    const brands = form.getValues("brandSpecialisms")
    if (brands.includes(code)) return setBrandError(`${code} is already listed.`)
    if (brands.length >= MAX_BRANDS) return setBrandError(`Keep to ${MAX_BRANDS} brands.`)
    form.setValue("brandSpecialisms", [...brands, code], { shouldDirty: true })
    setBrandDraft("")
    setBrandError(null)
  }
  const onBrandKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return
    event.preventDefault()
    addBrand()
  }

  const level = hvLevelOf(values.hvLevel ?? 0) ?? 0
  const expired = !values.doesNotExpire && isCalendarDate(values.hvLevelValidUntil ?? "") && (values.hvLevelValidUntil ?? "") < today && level > 0
  const deactivating = base?.isActive === true && values.isActive === false
  const pending = save.isPending
  const editingName = editing.mode === "edit" ? editing.name : "the new technician"

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-5">
        {conflict && base && (
          <ConflictPanel
            ref={conflictRef}
            title={`Someone else changed ${base.name}`}
            rows={conflictRows(technicianFields, technicianWrite(base), technicianWrite(conflict.current), conflict.mine)}
            actions={
              <>
                <Button type="button" onClick={reapply} className="cursor-pointer">
                  Reapply my changes
                </Button>
                <Button type="button" variant="outline" onClick={onDiscarded} className="cursor-pointer">
                  Discard my changes
                </Button>
              </>
            }
          >
            <p>Another Admin saved this technician after you opened it, so nothing of yours was saved.</p>
            <p className="text-muted-foreground">
              Reapply puts your changes on top of theirs for you to check and save; discard keeps theirs.
            </p>
          </ConflictPanel>
        )}
        {showFailure && (
          <FailureAlert
            failure={failure}
            action={`save ${editingName}`}
            onReload={onReload && (() => void reload())}
            reloading={reloading}
            reloadFailed={reloaded === "failed"}
            retrying={save.isPending}
            onRetry={submit}
          />
        )}
        {reloaded === "kept" && (
          <p role="status" className="rounded-lg bg-info-subtle px-3 py-2 text-sm text-pretty text-foreground">
            {`Read again: nobody has changed ${base?.name ?? editingName} since you opened it, and your changes are kept. Save them now.`}
          </p>
        )}
        {reappliedNote && (
          <p role="status" className="rounded-lg bg-info-subtle px-3 py-2 text-sm text-pretty text-foreground">
            Your changes are applied to the latest version. Check them, then save.
          </p>
        )}
        <FieldSet className="gap-4">
          <FieldLegend className="font-heading text-base font-semibold">Technician</FieldLegend>
          <Field data-invalid={Boolean(errors.name) || undefined} className="gap-1.5">
            <FieldLabel htmlFor={ids.name}>Name</FieldLabel>
            <Input
              {...nameField}
              ref={(element) => {
                nameField.ref(element)
                firstFieldRef.current = element
              }}
              id={ids.name}
              autoComplete="off"
              maxLength={120}
              disabled={pending}
              aria-invalid={Boolean(errors.name) || undefined}
              aria-describedby={errors.name ? ids.nameError : undefined}
            />
            <FieldMessage id={ids.nameError} message={errors.name?.message} />
          </Field>
          <Field data-invalid={Boolean(errors.employeeNumber) || undefined} className="gap-1.5">
            <FieldLabel htmlFor={ids.number}>Employee number</FieldLabel>
            <Input
              {...form.register("employeeNumber")}
              id={ids.number}
              autoComplete="off"
              spellCheck={false}
              maxLength={32}
              disabled={pending}
              aria-invalid={Boolean(errors.employeeNumber) || undefined}
              aria-describedby={errors.employeeNumber ? ids.numberError : undefined}
              className="max-w-48 font-mono tracking-wide"
            />
            <FieldMessage id={ids.numberError} message={errors.employeeNumber?.message} />
          </Field>
        </FieldSet>

        <Controller
          control={form.control}
          name="certifications"
          render={({ field }) => (
            <FieldSet className="gap-2">
              <FieldLegend className="font-heading text-base font-semibold">Certified for</FieldLegend>
              <p className="text-xs text-muted-foreground">What the technician may work on. Services need all of theirs.</p>
              <ul className="grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
                {CERTIFICATIONS.map((certification) => {
                  const { label, icon: Icon } = certifications[certification]
                  const checked = field.value.includes(certification)
                  return (
                    <li key={certification}>
                      <Label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 font-normal hover:bg-accent/50 pointer-coarse:min-h-11">
                        <Checkbox
                          checked={checked}
                          disabled={pending}
                          onCheckedChange={(next) =>
                            field.onChange(next ? [...field.value, certification] : field.value.filter((value) => value !== certification))
                          }
                        />
                        <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                        <span>{label}</span>
                      </Label>
                    </li>
                  )
                })}
              </ul>
            </FieldSet>
          )}
        />

        {vehicleAware && (
          <FieldSet className="gap-4 rounded-xl border border-border p-3 sm:p-4">
            <FieldLegend className="px-1 font-heading text-base font-semibold">HV competence</FieldLegend>
            <Controller
              control={form.control}
              name="hvLevel"
              render={({ field }) => (
                <div className="flex flex-col gap-2">
                  <span id={ids.level} className="text-sm font-medium">
                    HV level
                  </span>
                  <HvLevelField
                    ref={field.ref}
                    value={hvLevelOf(field.value) ?? 0}
                    labelledBy={ids.level}
                    disabled={pending}
                    onChange={(next: HvLevel) => {
                      field.onChange(next)
                      // Choosing a level is a person stating it: it is confirmed from then on.
                      if (next !== (base?.hvLevel ?? 0)) form.setValue("hvLevelConfirmed", true)
                    }}
                  />
                </div>
              )}
            />
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                <Field data-invalid={Boolean(errors.hvLevelValidUntil) || undefined} className="w-auto gap-1.5">
                  <FieldLabel htmlFor={ids.validUntil}>Valid until</FieldLabel>
                  <Input
                    {...form.register("hvLevelValidUntil")}
                    id={ids.validUntil}
                    type="date"
                    disabled={pending || values.doesNotExpire}
                    aria-invalid={Boolean(errors.hvLevelValidUntil) || undefined}
                    aria-describedby={[ids.validUntilHelp, errors.hvLevelValidUntil ? ids.validUntilError : null].filter(Boolean).join(" ")}
                    className="w-44 tabular-nums"
                  />
                </Field>
                <Controller
                  control={form.control}
                  name="doesNotExpire"
                  render={({ field }) => (
                    <Label className="flex min-h-10 cursor-pointer items-center gap-2.5 font-normal pointer-coarse:min-h-11">
                      <Checkbox
                        checked={field.value}
                        disabled={pending}
                        onCheckedChange={(next) => {
                          field.onChange(next === true)
                          if (!next && !form.getValues("hvLevelValidUntil")) form.setValue("hvLevelValidUntil", shiftDate(today, 365))
                          form.clearErrors("hvLevelValidUntil")
                        }}
                      />
                      Does not expire
                    </Label>
                  )}
                />
              </div>
              <p id={ids.validUntilHelp} className="text-xs text-pretty text-muted-foreground">
                {`The last day it counts, on ${dealership.name}'s calendar (${dealership.timeZoneId}), that day included.`}
              </p>
              <FieldMessage id={ids.validUntilError} message={errors.hvLevelValidUntil?.message} />
              {expired && (
                <p className="text-xs font-medium text-destructive">
                  {`Expired ${formatDay(values.hvLevelValidUntil ?? "", "dated")}: counts as no HV training until it is renewed.`}
                </p>
              )}
            </div>
            <Controller
              control={form.control}
              name="hvLevelConfirmed"
              render={({ field }) => (
                <div className="flex items-start gap-3">
                  <Checkbox
                    id={ids.confirmed}
                    checked={field.value}
                    disabled={pending}
                    onCheckedChange={(next) => field.onChange(next === true)}
                    aria-describedby={ids.confirmedHelp}
                    className="mt-0.5"
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Label htmlFor={ids.confirmed} className="cursor-pointer pointer-coarse:min-h-11 pointer-coarse:items-center">
                      Level confirmed
                    </Label>
                    <p id={ids.confirmedHelp} className="text-xs text-pretty text-muted-foreground">
                      A level carried over from the old high-voltage certificate stays unconfirmed until someone checks it. It counts when
                      booking either way.
                    </p>
                  </div>
                </div>
              )}
            />
            <div className="flex flex-col gap-2 border-t pt-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Brand specialisms</span>
                <p id={ids.brandHelp} className="text-xs text-muted-foreground">
                  Not used for allocation yet
                </p>
              </div>
              {(values.brandSpecialisms ?? []).length > 0 && (
                <ul aria-label="Brand specialisms" className="flex flex-wrap gap-1.5">
                  {(values.brandSpecialisms ?? []).map((brand) => (
                    <li key={brand} className="flex h-7 items-center gap-0.5 rounded-full border border-input pl-2.5 font-mono text-xs tracking-wide pointer-coarse:h-11">
                      {brand}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={pending}
                        aria-label={`Remove ${brand}`}
                        className="rounded-full"
                        onClick={() =>
                          form.setValue(
                            "brandSpecialisms",
                            form.getValues("brandSpecialisms").filter((value) => value !== brand),
                            { shouldDirty: true }
                          )
                        }
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Label htmlFor={ids.brand} className="sr-only">
                  Add a brand
                </Label>
                <Input
                  id={ids.brand}
                  value={brandDraft}
                  placeholder="For example BMW"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={32}
                  disabled={pending}
                  aria-invalid={Boolean(brandError || errors.brandSpecialisms) || undefined}
                  aria-describedby={[ids.brandHelp, brandError || errors.brandSpecialisms ? ids.brandError : null].filter(Boolean).join(" ")}
                  onChange={(event) => {
                    setBrandDraft(event.target.value)
                    if (brandError) setBrandError(null)
                  }}
                  onKeyDown={onBrandKey}
                  className="max-w-56 font-mono uppercase tracking-wide placeholder:normal-case placeholder:tracking-normal"
                />
                <Button type="button" variant="outline" disabled={pending} onClick={addBrand} className="cursor-pointer">
                  <Plus aria-hidden="true" />
                  Add brand
                </Button>
              </div>
              <FieldMessage id={ids.brandError} message={brandError ?? errors.brandSpecialisms?.message} />
            </div>
          </FieldSet>
        )}

        {editing.mode === "edit" && (
          <Controller
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <div className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <Switch
                    id={ids.active}
                    checked={field.value}
                    disabled={pending}
                    onCheckedChange={(next) => field.onChange(next)}
                    aria-describedby={ids.activeHelp}
                    className="mt-1"
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Label htmlFor={ids.active} className="cursor-pointer pointer-coarse:min-h-11 pointer-coarse:items-center">
                      Takes bookings
                    </Label>
                    <p id={ids.activeHelp} className="text-xs text-pretty text-muted-foreground">
                      Off, the technician is inactive: no new bookings, and nothing already booked moves.
                    </p>
                  </div>
                </div>
                {deactivating && editing.mode === "edit" && (
                  <UpcomingWork dealership={dealership} today={today} resource={{ kind: "technician", id: editing.id, name: editing.name }} />
                )}
              </div>
            )}
          />
        )}
      </div>

      <div className="flex flex-col gap-3 border-t bg-muted/30 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel} className="cursor-pointer max-sm:h-11">
            Cancel
          </Button>
          <Button ref={saveRef} type="submit" disabled={pending || conflict !== null} focusableWhenDisabled className="cursor-pointer max-sm:h-11">
            {pending && <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
            {pending ? "Saving…" : editing.mode === "edit" ? "Save changes" : "Add technician"}
          </Button>
        </div>
      </div>
    </form>
  )
}
