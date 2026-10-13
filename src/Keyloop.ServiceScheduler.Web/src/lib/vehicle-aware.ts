import type {
  AllocationCriterion,
  AllocationDecision,
  Certification,
  Powertrain,
  ProfileSource,
  VehicleClass,
  VehicleProfile,
} from "@/api/types.gen"
import { featureLabel } from "@/lib/features"

/** Powertrains in selection order (`Unknown` first as the default). */
export const POWERTRAINS = ["Unknown", "Ice", "MildHybrid", "FullHybrid", "PluginHybrid", "BatteryElectric", "FuelCell"] as const satisfies readonly Powertrain[]

export const powertrainLabels: Record<Powertrain, string> = {
  Unknown: "Unknown",
  Ice: "Petrol or diesel (ICE)",
  MildHybrid: "Mild hybrid",
  FullHybrid: "Full hybrid",
  PluginHybrid: "Plug-in hybrid",
  BatteryElectric: "Battery electric",
  FuelCell: "Hydrogen fuel cell",
}

const powertrainPhrases: Record<Powertrain, string> = {
  Unknown: "a vehicle whose powertrain isn't known, treated as high-voltage",
  Ice: "a petrol or diesel vehicle",
  MildHybrid: "a mild hybrid",
  FullHybrid: "a full hybrid",
  PluginHybrid: "a plug-in hybrid",
  BatteryElectric: "a battery-electric vehicle",
  FuelCell: "a fuel-cell vehicle",
}

export const VEHICLE_CLASSES = ["Unknown", "Car", "LightCommercial", "Heavy"] as const satisfies readonly VehicleClass[]

export const vehicleClassLabels: Record<VehicleClass, string> = {
  Unknown: "Unknown",
  Car: "Car",
  LightCommercial: "Light commercial (van)",
  Heavy: "Heavy vehicle",
}

/** Display labels for vehicle attribute provenance sources. */
export const provenanceLabels: Record<ProfileSource, string> = {
  Unknown: "not known",
  Declared: "declared",
  VinDecoded: "from VIN",
  RegistryLookup: "from registration",
  SuggestedConfirmed: "suggested, confirmed",
}

/** Returns true for powertrains that may carry a high-voltage system (`Unknown` included). */
export function mayBeHighVoltage(powertrain: Powertrain): boolean {
  return powertrain !== "Ice"
}

export type HvLevel = 0 | 1 | 2 | 3 | 4

/** IMI-style high-voltage competence levels (0–4) with short badge labels and descriptions. */
export const hvLevels: Record<HvLevel, { name: string; description: string }> = {
  0: { name: "No HV training", description: "Not trained to work on high-voltage vehicles." },
  1: { name: "Awareness", description: "High-voltage awareness: may work near, never on, the high-voltage system." },
  2: { name: "Routine maintenance", description: "Routine maintenance with the high-voltage system de-energised." },
  3: { name: "Component repair", description: "Repairs and replaces high-voltage components with the system switched off." },
  4: { name: "Live working", description: "Diagnoses and repairs with the high-voltage system live." },
}

/** Narrows an integer to a valid `HvLevel` (0–4), or returns `null`. */
export function hvLevelOf(value: number | null | undefined): HvLevel | null {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4 ? value : null
}

/** Human-readable explanations for built-in requirement policy rule codes. */
export const ruleExplanations = {
  "legacy-hv-component": "the service works on high-voltage components, whatever the powertrain",
  "hv-awareness": "alignment and MOT work happen close to a high-voltage system",
  "hv-routine": "routine work happens alongside high-voltage cabling",
  "hv-aircon": "on an electrified vehicle the air-con compressor is a high-voltage part",
  "hv-components": "high-voltage component work needs the system switched off, in an EV bay",
  "hv-post-collision": "a collision may have damaged high-voltage cabling or parts, so assessing it needs someone trained to work on them switched off",
  "heavy-vehicle": "a heavy vehicle needs a heavy-duty lift and a heavy-vehicle technician",
  "hv-live-diagnosis": "live working on the high-voltage system needs level 4 and an EV bay",
} as const satisfies Record<string, string>

export type RuleCode = keyof typeof ruleExplanations

export function ruleExplanation(code: string): string {
  return (ruleExplanations as Record<string, string>)[code] ?? `the workshop's rule ${code} applies`
}

/** Rule code requiring live high-voltage diagnosis (level 4 technician and EV bay). */
export const LIVE_DIAGNOSIS_RULE = "hv-live-diagnosis"

const technicianCriteria: Record<AllocationCriterion, (who: string, needs: string) => string> = {
  OnlyQualifiedResource: (who, needs) => `${who}: the only free technician ${needs || "qualified for the job"}`,
  PreferredResource: (who, needs) => `${who}: the technician you asked for, free and qualified ${needs || "for the job"}`,
  SurplusCompetences: (who, needs) =>
    `${who}: of the free technicians ${needs || "qualified for the job"}, the one with the fewest skills beyond this job, keeping specialists free`,
  LowestLoad: (who, needs) => `${who}: of the free technicians ${needs || "qualified for the job"}, the one with the least work booked that day`,
  Name: (who, needs) =>
    `${who}: the free technicians ${needs || "qualified for the job"} were equally suited and equally busy, so the first by name`,
  Id: (who, needs) => `${who}: the free technicians ${needs || "qualified for the job"} were alike in every respect, so a fixed tie-break chose`,
}

const bayCriteria: Record<AllocationCriterion, (bay: string, needs: string) => string> = {
  OnlyQualifiedResource: (bay, needs) => `${bay}: the only free bay ${needs || "that fits the job"}`,
  PreferredResource: (bay, needs) => `${bay}: the bay you asked for, free and ${needs ? `equipped ${needs}` : "suitable"}`,
  SurplusCompetences: (bay, needs) =>
    `${bay}: of the free bays ${needs || "that fit the job"}, the one with the least extra equipment, keeping specialist bays free`,
  LowestLoad: (bay, needs) => `${bay}: of the free bays ${needs || "that fit the job"}, the one with the least work booked that day`,
  Name: (bay, needs) => `${bay}: the free bays ${needs || "that fit the job"} were equally suited and equally busy, so the first by name`,
  Id: (bay, needs) => `${bay}: the free bays ${needs || "that fit the job"} were alike in every respect, so a fixed tie-break chose`,
}

export const ALLOCATION_CRITERIA = Object.keys(technicianCriteria) as AllocationCriterion[]

const joinNames = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`

function technicianNeeds(certifications: readonly Certification[], firedRules: readonly string[]): string[] {
  const needs = new Set(certifications.filter((certification) => certification !== "HighVoltageElectrical"))
  if (firedRules.includes("heavy-vehicle")) needs.add("HeavyVehicle")
  return [...needs].map(featureLabel)
}

function qualifiedPhrase(minimumHvLevel: number, needs: readonly string[]): string {
  const level = minimumHvLevel > 0 ? `at HV level ${minimumHvLevel} or above` : ""
  const skills = needs.length > 0 ? `with ${joinNames(needs)}` : ""
  return [level, skills].filter(Boolean).join(" ")
}

/** Formats a vehicle profile into a descriptive phrase (e.g. `"a battery-electric vehicle (declared)"`). */
export function vehiclePhrase(profile: Pick<VehicleProfile, "powertrain" | "vehicleClass" | "provenance">): string {
  const powertrain = powertrainPhrases[profile.powertrain]
  const declared = profile.provenance.powertrain === "Declared" ? " (declared)" : ""
  const heavy = profile.vehicleClass === "Heavy" ? ", heavy class" : profile.vehicleClass === "LightCommercial" ? ", a van" : ""
  return `${powertrain}${declared}${heavy}`
}

export interface AllocationExplanation {
  technician: string
  bay: string
  because: string[]
}

export interface ExplainInput {
  allocation: Pick<AllocationDecision, "decidedBy" | "bayDecidedBy" | "minimumHvLevel" | "firedRules">
  technician: string
  bay: string
  service: { requiredCertifications?: readonly Certification[]; requiredBayCapabilities?: readonly string[] } | undefined
  profile: VehicleProfile | null | undefined
}

/** Builds human-readable explanations for technician/bay selection and fired requirement rules. */
export function explainAllocation({ allocation, technician, bay, service, profile }: ExplainInput): AllocationExplanation {
  const needs = technicianNeeds(service?.requiredCertifications ?? [], allocation.firedRules)
  const vehicle = profile ? `, for ${vehiclePhrase(profile)}` : ""
  const equipmentNames = [
    ...new Set([
      ...(service?.requiredBayCapabilities ?? []),
      ...(allocation.firedRules.includes("heavy-vehicle") ? ["HeavyDutyLift"] : []),
      ...(allocation.firedRules.some((rule) => rule === "hv-components" || rule === LIVE_DIAGNOSIS_RULE) ? ["EvHighVoltage"] : []),
    ]),
  ]
    .filter((capability) => capability !== "StandardLift")
    .map(featureLabel)
  const equipped = equipmentNames.length > 0 ? `with ${joinNames(equipmentNames)}` : ""
  return {
    technician: `${technicianCriteria[allocation.decidedBy](technician, qualifiedPhrase(allocation.minimumHvLevel, needs))}${vehicle}.`,
    bay: `${bayCriteria[allocation.bayDecidedBy](bay, equipped)}.`,
    because: allocation.firedRules.map(ruleExplanation),
  }
}

export interface WhyNotContext {
  bay: string | null
  technician: string | null
  technicianLevel?: { level: number | null; validUntil: string | null }
  minimumHvLevel: number
  formatDate?: (date: string) => string
}

/** Explanations for why a preferred bay or technician was not selected (`reasons[]`). */
export const reasonExplanations = {
  "preferred-bay:not-at-dealership": (c: WhyNotContext) => `${c.bay ?? "The bay you asked for"} isn't at this dealership.`,
  "preferred-bay:inactive": (c: WhyNotContext) => `${c.bay ?? "The bay you asked for"} is out of service.`,
  "preferred-bay:missing-capabilities": (c: WhyNotContext) => `${c.bay ?? "The bay you asked for"} doesn't have the equipment this job needs.`,
  "preferred-bay:busy": (c: WhyNotContext) => `${c.bay ?? "The bay you asked for"} was busy at that time.`,
  "preferred-technician:not-at-dealership": (c: WhyNotContext) =>
    `${c.technician ?? "The technician you asked for"} doesn't work at this dealership.`,
  "preferred-technician:inactive": (c: WhyNotContext) => `${c.technician ?? "The technician you asked for"} isn't taking bookings.`,
  "preferred-technician:missing-certifications": (c: WhyNotContext) =>
    `${c.technician ?? "The technician you asked for"} isn't certified for everything this job needs.`,
  "preferred-technician:minimum-hv-level": (c: WhyNotContext) => {
    const who = c.technician ?? "The technician you asked for"
    const level = hvLevelOf(c.technicianLevel?.level)
    return level === null
      ? `${who} holds an HV level below the level ${c.minimumHvLevel} this job needs.`
      : `${who} holds HV level ${level}, below the level ${c.minimumHvLevel} this job needs.`
  },
  "preferred-technician:hv-expired": (c: WhyNotContext) => {
    const who = c.technician ?? "The technician you asked for"
    const until = c.technicianLevel?.validUntil
    return until
      ? `${who}'s HV level was valid until ${c.formatDate ? c.formatDate(until) : until}, before the appointment's date.`
      : `${who}'s HV level had expired by the appointment's date.`
  },
  "preferred-technician:busy": (c: WhyNotContext) => `${c.technician ?? "The technician you asked for"} was busy at that time.`,
} as const satisfies Record<string, (context: WhyNotContext) => string>

export type ReasonCode = keyof typeof reasonExplanations

export function whyNot(code: string, context: WhyNotContext): string {
  const explain = (reasonExplanations as Record<string, (context: WhyNotContext) => string>)[code]
  if (explain) return explain(context)
  const subject = code.startsWith("preferred-bay:")
    ? (context.bay ?? "The bay you asked for")
    : (context.technician ?? "The technician you asked for")
  return `${subject} wasn't chosen (${code}).`
}

export const profileAttributeLabels: Record<string, string> = {
  manufacturer: "Manufacturer",
  powertrain: "Powertrain",
  vehicleClass: "Vehicle class",
}

export function attributeLabel(attribute: string): string {
  return profileAttributeLabels[attribute] ?? attribute
}

/** Normalises an OEM manufacturer string to trimmed uppercase. */
export function manufacturerCode(value: string): string {
  return value.trim().toUpperCase()
}

/** Returns `value` unless it is empty or `"UNKNOWN"`, in which case returns `null`. */
export function knownManufacturer(value: string | null | undefined): string | null {
  return value && value.toUpperCase() !== "UNKNOWN" ? value : null
}

/** Vehicle attributes passed to the availability query. */
export interface AvailabilityVehicle {
  powertrain: Powertrain
  vehicleClass: VehicleClass
  manufacturer?: string
  needsLiveDiagnosis: boolean
}

/** Serialises `AvailabilityVehicle` into query parameters for the availability endpoint. */
export function availabilityVehicleQuery(vehicle: AvailabilityVehicle) {
  return {
    powertrain: vehicle.powertrain,
    vehicleClass: vehicle.vehicleClass,
    ...(vehicle.manufacturer ? { manufacturer: vehicle.manufacturer } : {}),
    ...(vehicle.needsLiveDiagnosis ? { needsLiveDiagnosis: true } : {}),
  }
}

const powertrainAdjectives: Record<Powertrain, string> = {
  Unknown: "",
  Ice: "petrol or diesel",
  MildHybrid: "mild-hybrid",
  FullHybrid: "full-hybrid",
  PluginHybrid: "plug-in hybrid",
  BatteryElectric: "battery-electric",
  FuelCell: "fuel-cell",
}

const classNouns: Record<VehicleClass, string> = { Unknown: "vehicle", Car: "car", LightCommercial: "van", Heavy: "heavy vehicle" }

/** Formats a summary phrase describing the vehicle criteria used for availability counts. */
export function vehicleQueryPhrase(vehicle: Pick<AvailabilityVehicle, "powertrain" | "vehicleClass" | "needsLiveDiagnosis">): string {
  const noun = classNouns[vehicle.vehicleClass]
  const base =
    vehicle.powertrain === "Unknown"
      ? `a ${noun} of unknown powertrain, planned as high-voltage`
      : `a ${powertrainAdjectives[vehicle.powertrain]} ${noun}`
  return vehicle.needsLiveDiagnosis ? `${base}, with live HV diagnosis` : base
}

/** Returns true when the service and powertrain support the "Needs live HV diagnosis" option. */
export function liveDiagnosisApplies(
  service: { requiredBayCapabilities: readonly string[]; requiredCertifications: readonly string[] } | undefined,
  powertrain: Powertrain
): boolean {
  if (!service || !mayBeHighVoltage(powertrain)) return false
  return (
    service.requiredBayCapabilities.some((capability) => capability === "Diagnostics" || capability === "EvHighVoltage") ||
    service.requiredCertifications.some((certification) => certification === "Diagnostics" || certification === "HighVoltageElectrical")
  )
}

/** Describes additional resource requirements imposed by the vehicle profile when no slots are available. */
export function vehicleNeeds(vehicle: Pick<AvailabilityVehicle, "powertrain" | "vehicleClass" | "needsLiveDiagnosis">): string[] {
  const needs: string[] = []
  if (vehicle.needsLiveDiagnosis) needs.push("an HV level 4 technician and an EV bay, for live working on the high-voltage system")
  else if (mayBeHighVoltage(vehicle.powertrain)) needs.push("a technician with the HV level this service needs on a vehicle that may be high-voltage")
  if (vehicle.vehicleClass === "Heavy") needs.push("a heavy-duty lift and a technician certified for heavy vehicles")
  return needs
}

/** Formats an audit actor string (`user:<email>` or `system`) for display. */
export function declarerName(declaredBy: string): string {
  return declaredBy.startsWith("user:") ? declaredBy.slice("user:".length) : declaredBy
}
