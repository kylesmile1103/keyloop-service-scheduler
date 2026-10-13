import { zodResolver } from "@hookform/resolvers/zod"
import { useDataProvider, useForm as useRefineForm } from "@refinedev/core"
import { LoaderCircle } from "lucide-react"
import { type RefObject, useId, useRef, useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { z } from "zod"

import type { AdminBayResponse, BayCapability, BayWriteRequest, DealershipResponse } from "@/api/types.gen"
import { ProblemAlert } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useWriteMutation } from "@/hooks/use-write-mutation"
import { bayCapabilities } from "@/lib/features"
import { fieldErrors, parseProblem, problemSlug } from "@/lib/problem-details"

import { ConflictPanel } from "../components/conflict-panel"
import { EditSheet } from "../components/edit-sheet"
import { FailureAlert, FieldMessage } from "../components/form-parts"
import { UpcomingWork } from "../components/upcoming-work"
import { type Conflict, conflictOf, resourceTag } from "../lib/admin-api"
import { bayFields, bayWrite, conflictRows, reapplied } from "../lib/changes"
import { type SchedulerHttpError, shownFailure } from "../lib/http-error"

/** What the sheet edits: a new bay, or one by id (its name titles the sheet). */
export type BayEditing = { mode: "create" } | { mode: "edit"; id: string; name: string }

/** The capabilities in the order the API lists them. */
const CAPABILITIES = Object.keys(bayCapabilities) as BayCapability[]

const schema = z.object({
  name: z.string().trim().min(1, "Enter the bay's name.").max(100, "Keep the name to 100 characters."),
  capabilities: z.array(z.enum(CAPABILITIES as [BayCapability, ...BayCapability[]])),
  isActive: z.boolean(),
})

type BayFormValues = z.input<typeof schema>

const valuesOf = (state: BayWriteRequest | null): BayFormValues => ({
  name: state?.name ?? "",
  capabilities: state ? [...state.capabilities] : [],
  isActive: state?.isActive ?? true,
})

const bodyOf = (values: BayFormValues): BayWriteRequest => ({
  name: values.name.trim(),
  capabilities: CAPABILITIES.filter((capability) => values.capabilities.includes(capability)),
  isActive: values.isActive,
})

const LABELS: Record<string, string> = { name: "Name", capabilities: "Equipment" }

interface BaySheetProps {
  editing: BayEditing | null
  open: boolean
  onOpenChange: (open: boolean) => void
  dealership: DealershipResponse
  today: string
  phone: boolean
  returnFocus: () => HTMLElement | null
  onSaved: (saved: AdminBayResponse, editing: BayEditing) => void
  onDiscarded: () => void
}

/**
 * Adding or editing a bay (Task 30b, UI_DESIGN 11.24): the technician form's pattern (the record read once through Refine's
 * `useForm`, the whole state sent with its version as a write bound to the Admin, the 412 comparison) for a bay's name, its
 * equipment and whether it is in service, with the upcoming-work preview when it is taken out of service.
 */
export function BaySheet({ editing, open, onOpenChange, dealership, today, phone, returnFocus, onSaved, onDiscarded }: BaySheetProps) {
  const firstField = useRef<HTMLInputElement>(null)
  return (
    <EditSheet
      open={open && editing !== null}
      onOpenChange={onOpenChange}
      phone={phone}
      title={editing?.mode === "edit" ? `Edit ${editing.name}` : "Add bay"}
      description="Changes apply to new bookings. Appointments already booked keep their bay; the board flags any that no longer qualify."
      initialFocus={firstField}
      returnFocus={returnFocus}
    >
      {editing && (
        <BaySheetBody
          key={editing.mode === "edit" ? editing.id : "create"}
          editing={editing}
          dealership={dealership}
          today={today}
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
  editing: BayEditing
  dealership: DealershipResponse
  today: string
  firstFieldRef: RefObject<HTMLInputElement | null>
  onCancel: () => void
  onSaved: (saved: AdminBayResponse) => void
  onDiscarded: () => void
}

function BaySheetBody(props: BodyProps) {
  const { editing, dealership, today } = props
  const { query } = useRefineForm<AdminBayResponse, SchedulerHttpError>({
    resource: "bays",
    action: editing.mode === "edit" ? "edit" : "create",
    id: editing.mode === "edit" ? editing.id : undefined,
    meta: { dealershipId: dealership.id, date: today, view: "admin" },
    redirect: false,
    queryOptions: { enabled: editing.mode === "edit", refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false, staleTime: Infinity, gcTime: 0 },
  })
  const [generation, setGeneration] = useState(0)

  if (editing.mode === "create") return <BayFormBody {...props} base={null} />
  const record = query?.data?.data
  if (!record) {
    if (query?.error) {
      return (
        <div className="flex-1 overflow-y-auto p-4">
          <ProblemAlert title="Couldn’t load the bay" error={shownFailure(query.error)} onRetry={() => void query.refetch()} retrying={query.isFetching} />
        </div>
      )
    }
    return (
      <div className="flex flex-1 flex-col gap-5 p-4" aria-busy="true">
        <p role="status" className="sr-only">
          Loading the bay…
        </p>
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }
  return (
    <BayFormBody
      key={generation}
      {...props}
      base={record}
      onReload={async () => {
        await query?.refetch()
        setGeneration((value) => value + 1)
      }}
    />
  )
}

type SaveVariables = { body: BayWriteRequest; ifMatch?: string }

function BayFormBody({
  editing,
  dealership,
  today,
  firstFieldRef,
  base: opened,
  onCancel,
  onSaved,
  onDiscarded,
  onReload,
}: BodyProps & { base: AdminBayResponse | null; onReload?: () => void }) {
  const ids = { name: useId(), nameError: useId(), active: useId(), activeHelp: useId() }
  const dataProvider = useDataProvider()
  const [base, setBase] = useState(opened)
  const [conflict, setConflict] = useState<(Conflict<AdminBayResponse> & { mine: BayWriteRequest }) | null>(null)
  const [reappliedNote, setReappliedNote] = useState(false)
  const conflictRef = useRef<HTMLElement>(null)
  const saveRef = useRef<HTMLButtonElement>(null)

  const form = useForm<BayFormValues>({ defaultValues: valuesOf(opened ? bayWrite(opened) : null), resolver: zodResolver(schema) })
  const values = useWatch({ control: form.control })
  const { errors } = form.formState
  const nameField = form.register("name")

  const save = useWriteMutation<AdminBayResponse, SchedulerHttpError, SaveVariables>({
    writes: "admin",
    mutationFn: async ({ body, ifMatch }, write) => {
      const provider = dataProvider()
      const meta = { dealershipId: dealership.id, fetch: write.fetch(), ifMatch }
      const answer =
        editing.mode === "edit"
          ? await provider.update({ resource: "bays", id: editing.id, variables: body, meta })
          : await provider.create({ resource: "bays", variables: body, meta })
      return answer.data as unknown as AdminBayResponse
    },
    onSuccess: (saved) => onSaved(saved),
    onError: (error, variables) => {
      const failure = shownFailure(error)
      const stale = conflictOf<AdminBayResponse>(failure)
      if (stale) {
        setConflict({ ...stale, mine: variables.body })
        requestAnimationFrame(() => conflictRef.current?.focus())
        return
      }
      const problem = parseProblem(failure)
      if (problem && problemSlug(problem) === "validation-error") {
        let first = true
        for (const [path, message] of Object.entries(fieldErrors(problem, LABELS))) {
          const name = path.split(/[.[]/)[0] as keyof BayFormValues
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
  const pending = save.isPending
  const name = editing.mode === "edit" ? editing.name : "the new bay"

  const submit = () => {
    const send = save.begin()
    if (!send) return
    setReappliedNote(false)
    void form.handleSubmit((checked) => {
      setConflict(null)
      send({ body: bodyOf(checked), ifMatch: base ? resourceTag(base.version) : undefined })
    })()
  }

  const reapply = () => {
    if (!conflict || !base) return
    const merged = reapplied(bayFields, bayWrite(base), bayWrite(conflict.current), conflict.mine)
    setBase(conflict.current)
    form.reset(valuesOf(merged))
    setConflict(null)
    setReappliedNote(true)
    save.reset()
    requestAnimationFrame(() => saveRef.current?.focus())
  }

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
            maxLength={100}
            disabled={pending}
            aria-invalid={Boolean(errors.name) || undefined}
            aria-describedby={errors.name ? ids.nameError : undefined}
          />
          <FieldMessage id={ids.nameError} message={errors.name?.message} />
        </Field>

        <Controller
          control={form.control}
          name="capabilities"
          render={({ field }) => (
            <FieldSet className="gap-2">
              <FieldLegend className="font-heading text-base font-semibold">Equipment</FieldLegend>
              <FieldDescription className="text-xs">What the bay can take. A service needs a bay with all of its equipment.</FieldDescription>
              <ul className="grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
                {CAPABILITIES.map((capability) => {
                  const { label, icon: Icon } = bayCapabilities[capability]
                  return (
                    <li key={capability}>
                      <Label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 font-normal hover:bg-accent/50 pointer-coarse:min-h-11">
                        <Checkbox
                          checked={field.value.includes(capability)}
                          disabled={pending}
                          onCheckedChange={(next) =>
                            field.onChange(next ? [...field.value, capability] : field.value.filter((value) => value !== capability))
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

        {editing.mode === "edit" && (
          <Controller
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <div className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <Switch id={ids.active} checked={field.value} disabled={pending} onCheckedChange={(next) => field.onChange(next)} aria-describedby={ids.activeHelp} className="mt-1" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Label htmlFor={ids.active} className="cursor-pointer pointer-coarse:min-h-11 pointer-coarse:items-center">
                      In service
                    </Label>
                    <p id={ids.activeHelp} className="text-xs text-pretty text-muted-foreground">
                      Off, the bay is out of service: no new bookings, and nothing already booked moves.
                    </p>
                  </div>
                </div>
                {base?.isActive === true && values.isActive === false && (
                  <UpcomingWork dealership={dealership} today={today} resource={{ kind: "bay", id: editing.id, name: editing.name }} />
                )}
              </div>
            )}
          />
        )}
      </div>

      <div className="flex flex-col gap-3 border-t bg-muted/30 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {conflict && base && (
          <ConflictPanel
            ref={conflictRef}
            title={`Someone else changed ${base.name}`}
            rows={conflictRows(bayFields, bayWrite(base), bayWrite(conflict.current), conflict.mine)}
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
            <p>Another Admin saved this bay after you opened it, so nothing of yours was saved.</p>
            <p className="text-muted-foreground">Reapply puts your changes on top of theirs for you to check and save; discard keeps theirs.</p>
          </ConflictPanel>
        )}
        {failure !== null && conflict === null && !fieldRefusal && (
          <FailureAlert failure={failure} action={`save ${name}`} onReload={onReload} retrying={pending} onRetry={submit} />
        )}
        {reappliedNote && (
          <p role="status" className="rounded-lg bg-info-subtle px-3 py-2 text-sm text-pretty text-foreground">
            Your changes are applied to the latest version. Check them, then save.
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel} className="cursor-pointer max-sm:h-11">
            Cancel
          </Button>
          <Button ref={saveRef} type="submit" disabled={pending} focusableWhenDisabled className="cursor-pointer max-sm:h-11">
            {pending && <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
            {pending ? "Saving…" : editing.mode === "edit" ? "Save changes" : "Add bay"}
          </Button>
        </div>
      </div>
    </form>
  )
}
