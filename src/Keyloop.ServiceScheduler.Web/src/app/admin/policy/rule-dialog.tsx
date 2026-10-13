import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import { Zap } from "lucide-react"
import { useId, useState } from "react"

import type { BayCapability, Certification, Powertrain, RequirementCondition, RequirementRuleInput, ServiceTypeResponse, VehicleClass } from "@/api/types.gen"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { bayCapabilities, certifications } from "@/lib/features"
import { cn } from "@/lib/utils"
import { type HvLevel, hvLevelOf, POWERTRAINS, powertrainLabels, VEHICLE_CLASSES, vehicleClassLabels } from "@/lib/vehicle-aware"

import { FieldMessage } from "../components/form-parts"
import { HvLevelField } from "../technicians/hv-level-field"
import { conditionLabels, HV_POWERTRAINS } from "./rule-words"

const CODE = /^[a-z][a-z0-9-]{0,63}$/
const CONDITIONS: readonly RequirementCondition[] = ["ServicePowertrain", "VehicleClass", "LiveDiagnosis"]
const CAPABILITIES = Object.keys(bayCapabilities) as BayCapability[]
const CERTIFICATIONS = Object.keys(certifications) as Certification[]

interface RuleDialogProps {
  /** The rule being edited (`isNew` for one being added); `null` keeps the dialog closed. */
  editing: { rule: RequirementRuleInput; isNew: boolean } | null
  onOpenChange: (open: boolean) => void
  /** The draft's other rules, for the code's uniqueness. */
  others: readonly RequirementRuleInput[]
  services: readonly ServiceTypeResponse[] | undefined
  onSave: (rule: RequirementRuleInput) => void
}

/**
 * Adding or editing one typed rule of the draft (UI_DESIGN 11.24): its code (a new rule's only: appointments name the rules
 * they were booked under by code), its order, when it applies (a service on some powertrains, a vehicle class, or live HV
 * diagnosis, each with only its own selectors), and what it adds (a minimum HV level on the technicians' staircase, bay
 * equipment, certifications). Saving changes the draft only; nothing is sent until the draft is previewed and published.
 */
export function RuleDialog({ editing, onOpenChange, others, services, onSave }: RuleDialogProps) {
  return (
    <Dialog open={editing !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {editing && (
          <RuleForm
            key={editing.isNew ? "new" : editing.rule.code}
            rule={editing.rule}
            isNew={editing.isNew}
            others={others}
            services={services}
            onCancel={() => onOpenChange(false)}
            onSave={onSave}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

type Errors = Partial<Record<"code" | "order" | "serviceCodes" | "powertrains" | "vehicleClass", string>>

function check(rule: RequirementRuleInput, isNew: boolean, others: readonly RequirementRuleInput[]): Errors {
  const errors: Errors = {}
  if (isNew && !CODE.test(rule.code)) errors.code = "Use lower-case letters, digits and hyphens, starting with a letter, up to 64 characters."
  else if (isNew && others.some((other) => other.code === rule.code)) errors.code = "Another rule already has this code."
  if (!Number.isInteger(rule.order) || rule.order < 0) errors.order = "Use a whole number, 0 or more."
  if (rule.condition === "ServicePowertrain") {
    if (rule.serviceCodes.length === 0) errors.serviceCodes = "Choose at least one service."
    if (rule.powertrains.length === 0) errors.powertrains = "Choose at least one powertrain."
  }
  if (rule.condition === "VehicleClass" && !rule.vehicleClass) errors.vehicleClass = "Choose the vehicle class."
  return errors
}

/** Only the selectors that belong to the condition (the API refuses the others). */
function typed(rule: RequirementRuleInput): RequirementRuleInput {
  switch (rule.condition) {
    case "ServicePowertrain":
      return { ...rule, vehicleClass: null }
    case "VehicleClass":
      return { ...rule, powertrains: [], serviceCodes: [] }
    case "LiveDiagnosis":
      return { ...rule, powertrains: [], serviceCodes: [], vehicleClass: null }
  }
}

function RuleForm({
  rule: initial,
  isNew,
  others,
  services,
  onCancel,
  onSave,
}: {
  rule: RequirementRuleInput
  isNew: boolean
  others: readonly RequirementRuleInput[]
  services: readonly ServiceTypeResponse[] | undefined
  onCancel: () => void
  onSave: (rule: RequirementRuleInput) => void
}) {
  const ids = {
    code: useId(),
    codeHelp: useId(),
    codeError: useId(),
    order: useId(),
    orderHelp: useId(),
    orderError: useId(),
    condition: useId(),
    services: useId(),
    servicesError: useId(),
    powertrains: useId(),
    powertrainsError: useId(),
    vehicleClass: useId(),
    vehicleClassError: useId(),
    level: useId(),
  }
  const [rule, setRule] = useState(initial)
  const [orderText, setOrderText] = useState(String(initial.order))
  const [errors, setErrors] = useState<Errors>({})
  const set = (change: Partial<RequirementRuleInput>) => setRule((previous) => ({ ...previous, ...change }))
  const toggle = <T extends string>(values: readonly T[], value: T, on: boolean) => (on ? [...values, value] : values.filter((item) => item !== value))

  const save = () => {
    const order = /^\d+$/.test(orderText.trim()) ? Number(orderText.trim()) : -1
    const candidate = typed({ ...rule, code: rule.code.trim(), order })
    const found = check(candidate, isNew, others)
    setErrors(found)
    const first = (["code", "order", "serviceCodes", "powertrains", "vehicleClass"] as const).find((key) => found[key])
    if (first) {
      const target = { code: ids.code, order: ids.order, serviceCodes: ids.services, powertrains: ids.powertrains, vehicleClass: ids.vehicleClass }[first]
      requestAnimationFrame(() => (document.getElementById(target)?.querySelector<HTMLElement>("input, button") ?? document.getElementById(target))?.focus())
      return
    }
    onSave(candidate)
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
      className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col"
    >
      <div className="flex flex-col gap-1 border-b p-4 pr-12">
        <DialogTitle className="font-heading text-lg font-semibold">{isNew ? "Add rule" : `Edit rule ${initial.code}`}</DialogTitle>
        <DialogDescription className="text-pretty">
          A rule adds needs to the jobs it applies to. It changes the draft only: preview the draft, then publish it as a new version.
        </DialogDescription>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <Field data-invalid={Boolean(errors.code) || undefined} className="gap-1.5">
            {isNew ? (
              <>
                <FieldLabel htmlFor={ids.code}>Code</FieldLabel>
                <Input
                  id={ids.code}
                  value={rule.code}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={64}
                  placeholder="for example van-hv-awareness"
                  aria-invalid={Boolean(errors.code) || undefined}
                  aria-describedby={[ids.codeHelp, errors.code ? ids.codeError : null].filter(Boolean).join(" ")}
                  onChange={(event) => set({ code: event.target.value })}
                  className="font-mono tracking-wide"
                />
              </>
            ) : (
              <>
                <span className="text-sm font-medium">Code</span>
                <code className="flex h-10 items-center font-mono text-sm tracking-wide">{rule.code}</code>
              </>
            )}
            <p id={ids.codeHelp} className="text-xs text-muted-foreground">
              {isNew ? "How appointments name the rules they were booked under. It can't change later." : "A rule's code stays: appointments name it."}
            </p>
            <FieldMessage id={ids.codeError} message={errors.code} />
          </Field>
          <Field data-invalid={Boolean(errors.order) || undefined} className="gap-1.5">
            <FieldLabel htmlFor={ids.order}>Order</FieldLabel>
            <Input
              id={ids.order}
              value={orderText}
              inputMode="numeric"
              aria-invalid={Boolean(errors.order) || undefined}
              aria-describedby={[ids.orderHelp, errors.order ? ids.orderError : null].filter(Boolean).join(" ")}
              onChange={(event) => setOrderText(event.target.value)}
              className="tabular-nums"
            />
            <p id={ids.orderHelp} className="text-xs text-muted-foreground">
              Lowest first.
            </p>
            <FieldMessage id={ids.orderError} message={errors.order} />
          </Field>
        </div>

        <FieldSet className="gap-2">
          <FieldLegend id={ids.condition} className="font-heading text-base font-semibold">
            Applies to
          </FieldLegend>
          <RadioGroup
            value={rule.condition}
            onValueChange={(next) => typeof next === "string" && set({ condition: next as RequirementCondition })}
            aria-labelledby={ids.condition}
            className="grid gap-2 sm:grid-cols-3"
          >
            {CONDITIONS.map((condition) => (
              <Radio.Root key={condition} value={condition} aria-label={conditionLabels[condition]} className={choice}>
                <RadioMark />
                <span>{conditionLabels[condition]}</span>
              </Radio.Root>
            ))}
          </RadioGroup>
        </FieldSet>

        {rule.condition === "ServicePowertrain" && (
          <>
            <FieldSet id={ids.services} className="gap-2" aria-describedby={errors.serviceCodes ? ids.servicesError : undefined}>
              <FieldLegend variant="label">Services</FieldLegend>
              <ul className="grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
                {(services ?? []).map((service) => (
                  <li key={service.code}>
                    <Label className={row}>
                      <Checkbox
                        checked={rule.serviceCodes.includes(service.code)}
                        aria-invalid={Boolean(errors.serviceCodes) || undefined}
                        onCheckedChange={(on) => set({ serviceCodes: toggle(rule.serviceCodes, service.code, on === true) })}
                      />
                      <span className="min-w-0">{service.name}</span>
                    </Label>
                  </li>
                ))}
              </ul>
              <FieldMessage id={ids.servicesError} message={errors.serviceCodes} />
            </FieldSet>
            <FieldSet id={ids.powertrains} className="gap-2" aria-describedby={errors.powertrains ? ids.powertrainsError : undefined}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldLegend variant="label" className="mb-0">
                  Powertrains
                </FieldLegend>
                <Button type="button" variant="outline" size="sm" className="cursor-pointer" onClick={() => set({ powertrains: [...HV_POWERTRAINS] })}>
                  <Zap aria-hidden="true" />
                  Every powertrain that may be high-voltage
                </Button>
              </div>
              <ul className="grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
                {POWERTRAINS.map((powertrain: Powertrain) => (
                  <li key={powertrain}>
                    <Label className={row}>
                      <Checkbox
                        checked={rule.powertrains.includes(powertrain)}
                        aria-invalid={Boolean(errors.powertrains) || undefined}
                        onCheckedChange={(on) => set({ powertrains: toggle(rule.powertrains, powertrain, on === true) })}
                      />
                      <span>{powertrain === "Unknown" ? "Unknown (planned as high-voltage)" : powertrainLabels[powertrain]}</span>
                    </Label>
                  </li>
                ))}
              </ul>
              <FieldMessage id={ids.powertrainsError} message={errors.powertrains} />
            </FieldSet>
          </>
        )}

        {rule.condition === "VehicleClass" && (
          <FieldSet className="gap-2">
            <FieldLegend id={ids.vehicleClass} variant="label">
              Vehicle class
            </FieldLegend>
            <RadioGroup
              value={rule.vehicleClass}
              onValueChange={(next) => typeof next === "string" && set({ vehicleClass: next as VehicleClass })}
              aria-labelledby={ids.vehicleClass}
              aria-describedby={errors.vehicleClass ? ids.vehicleClassError : undefined}
              className="grid gap-2 sm:grid-cols-2"
            >
              {VEHICLE_CLASSES.map((vehicleClass) => (
                <Radio.Root key={vehicleClass} value={vehicleClass} aria-label={vehicleClassLabels[vehicleClass]} className={choice}>
                  <RadioMark />
                  <span>{vehicleClassLabels[vehicleClass]}</span>
                </Radio.Root>
              ))}
            </RadioGroup>
            <FieldMessage id={ids.vehicleClassError} message={errors.vehicleClass} />
          </FieldSet>
        )}

        {rule.condition === "LiveDiagnosis" && (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-pretty">
            Applies to every booking that asks for live HV diagnosis: working on the high-voltage system while it is live.
          </p>
        )}

        <FieldSet className="gap-4">
          <FieldLegend className="font-heading text-base font-semibold">Needs</FieldLegend>
          <div className="flex flex-col gap-2">
            <span id={ids.level} className="text-sm font-medium">
              Minimum HV level
            </span>
            <HvLevelField value={hvLevelOf(rule.minimumHvLevel) ?? 0} labelledBy={ids.level} onChange={(level: HvLevel) => set({ minimumHvLevel: level })} />
          </div>
          <FieldSet className="gap-2">
            <FieldLegend variant="label">Bay equipment</FieldLegend>
            <ul className="grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
              {CAPABILITIES.map((capability) => {
                const { label, icon: Icon } = bayCapabilities[capability]
                return (
                  <li key={capability}>
                    <Label className={row}>
                      <Checkbox
                        checked={rule.bayCapabilities.includes(capability)}
                        onCheckedChange={(on) => set({ bayCapabilities: toggle(rule.bayCapabilities, capability, on === true) })}
                      />
                      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                      <span>{label}</span>
                    </Label>
                  </li>
                )
              })}
            </ul>
          </FieldSet>
          <FieldSet className="gap-2">
            <FieldLegend variant="label">Certifications</FieldLegend>
            <ul className="grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
              {CERTIFICATIONS.map((certification) => {
                const { label, icon: Icon } = certifications[certification]
                return (
                  <li key={certification}>
                    <Label className={row}>
                      <Checkbox
                        checked={rule.certifications.includes(certification)}
                        onCheckedChange={(on) => set({ certifications: toggle(rule.certifications, certification, on === true) })}
                      />
                      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                      <span>{label}</span>
                    </Label>
                  </li>
                )
              })}
            </ul>
          </FieldSet>
        </FieldSet>
      </div>

      <DialogFooter className="m-0 rounded-none border-t px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button type="button" variant="outline" onClick={onCancel} className="cursor-pointer">
          Cancel
        </Button>
        <Button type="submit" className="cursor-pointer">
          Save rule
        </Button>
      </DialogFooter>
    </form>
  )
}

const row = "flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 font-normal hover:bg-accent/50 pointer-coarse:min-h-11"

/** A radio card (11.6's suggested-service card, smaller): a filled mark and the choice's name. */
const choice = cn(
  "group/choice flex min-h-11 cursor-pointer items-center gap-2.5 rounded-chip border border-input bg-card px-3 py-2 text-left text-sm outline-none",
  "hover:not-data-checked:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:border-primary data-checked:ring-1 data-checked:ring-primary"
)

function RadioMark() {
  return (
    <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center rounded-full border border-input group-data-checked/choice:border-primary group-data-checked/choice:bg-primary">
      <span className="hidden size-1.5 rounded-full bg-primary-foreground group-data-checked/choice:block" />
    </span>
  )
}
