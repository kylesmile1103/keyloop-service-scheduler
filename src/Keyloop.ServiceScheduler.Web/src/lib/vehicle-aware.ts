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

/**
 * Vehicle-aware requirements (ADR-029) in the screen's words: the vehicle's attributes and where each came from, the
 * IMI-style high-voltage (HV) competence levels, the policy rules that raise a job's requirements, and the allocation
 * explanation ("why this technician", "why not the one asked for"). One catalogue, keyed by the API's own values, so a
 * value the contract adds is a compile error here (the records are exhaustive) and a test failure (lib/vehicle-aware.test.ts
 * reads the generated client and the domain's codes).
 */

/** The powertrains in the order a person picks them: Unknown first, as the default. */
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

/** The vehicle in a sentence: "a battery-electric vehicle". */
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

/** Where an attribute came from, as the provenance chip says it. */
export const provenanceLabels: Record<ProfileSource, string> = {
  Unknown: "not known",
  Declared: "declared",
  VinDecoded: "from VIN",
  RegistryLookup: "from registration",
  SuggestedConfirmed: "suggested, confirmed",
}

/** Powertrains with a high-voltage system: Unknown is treated as one until someone declares otherwise. */
export function mayBeHighVoltage(powertrain: Powertrain): boolean {
  return powertrain !== "Ice"
}

export type HvLevel = 0 | 1 | 2 | 3 | 4

/** The IMI-style competence levels (ADR-029 "Domain facts"): a short name for badges, a sentence for details. */
export const hvLevels: Record<HvLevel, { name: string; description: string }> = {
  0: { name: "No HV training", description: "Not trained to work on high-voltage vehicles." },
  1: { name: "Awareness", description: "High-voltage awareness: may work near, never on, the high-voltage system." },
  2: { name: "Routine maintenance", description: "Routine maintenance with the high-voltage system de-energised." },
  3: { name: "Component repair", description: "Repairs and replaces high-voltage components with the system switched off." },
  4: { name: "Live working", description: "Diagnoses and repairs with the high-voltage system live." },
}

/** A level the API sends (0 to 4), or `null` for anything else. */
export function hvLevelOf(value: number | null | undefined): HvLevel | null {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4 ? value : null
}

/**
 * The policy rules a job's requirements came from (`firedRules`), in plain words. The codes are the default policy's
 * (ARCHITECTURE §8.7) and the legacy component floor; a dealership's own rule code is named as it is.
 */
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

/** The rule that asks for live working on the HV system: the job needs two trained people, and the booking reserves one. */
export const LIVE_DIAGNOSIS_RULE = "hv-live-diagnosis"

/**
 * The deciding comparison (`decidedBy`, `bayDecidedBy`), as the explanation sentence words it. `needs` is what the job
 * asked of the resource ("at HV level 3 or above with Diagnostics", "with EV high voltage"), empty when nothing special.
 */
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

/** Every deciding criterion the catalogue words (for the completeness test). */
export const ALLOCATION_CRITERIA = Object.keys(technicianCriteria) as AllocationCriterion[]

/** "Brakes and Heavy vehicle" */
const joinNames = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`

/** What the job asked of a technician: the service's certifications (the legacy HV one is the level now) and the rules'. */
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

/** The vehicle the allocation was made for: "a battery-electric vehicle (declared)", "a heavy vehicle". */
export function vehiclePhrase(profile: Pick<VehicleProfile, "powertrain" | "vehicleClass" | "provenance">): string {
  const powertrain = powertrainPhrases[profile.powertrain]
  const declared = profile.provenance.powertrain === "Declared" ? " (declared)" : ""
  const heavy = profile.vehicleClass === "Heavy" ? ", heavy class" : profile.vehicleClass === "LightCommercial" ? ", a van" : ""
  return `${powertrain}${declared}${heavy}`
}

export interface AllocationExplanation {
  /** One sentence for the technician, in the ADR's style: "Ben Okafor: the only free technician at HV level 3 or above with Diagnostics, for ...". */
  technician: string
  /** The bay's sentence. */
  bay: string
  /** Why the job needed what it needed (the fired rules, in order), each in plain words. */
  because: string[]
}

export interface ExplainInput {
  allocation: Pick<AllocationDecision, "decidedBy" | "bayDecidedBy" | "minimumHvLevel" | "firedRules">
  technician: string
  bay: string
  /** The service's own needs, from the catalogue (the appointment carries only its id and name). */
  service: { requiredCertifications?: readonly Certification[]; requiredBayCapabilities?: readonly string[] } | undefined
  profile: VehicleProfile | null | undefined
}

/** The allocation, explained: the deciding comparison with the competence it required, for this vehicle. */
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

/** A preferred resource's name, from the roster; `null` when it is not on it (another dealership's, or gone). */
export interface WhyNotContext {
  /** The preferred bay's name, or `null`. */
  bay: string | null
  /** The preferred technician's name, or `null`. */
  technician: string | null
  /** The preferred technician's HV level and its expiry, when the roster carries them (a role, with the switch on). */
  technicianLevel?: { level: number | null; validUntil: string | null }
  minimumHvLevel: number
  /** "1 Oct 2026": a local date in words, for an expiry. */
  formatDate?: (date: string) => string
}

/**
 * Why a preferred bay or technician was not chosen (`reasons[]`), one sentence per code, naming the resource from the
 * roster. The codes are the domain's (`AllocationPolicy`); an unknown one is still said, in its own words.
 */
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

/** The attribute names a `vehicle-profile-conflict` names (`conflictingAttributes`), for people. */
export const profileAttributeLabels: Record<string, string> = {
  manufacturer: "Manufacturer",
  powertrain: "Powertrain",
  vehicleClass: "Vehicle class",
}

export function attributeLabel(attribute: string): string {
  return profileAttributeLabels[attribute] ?? attribute
}

/** A normalised OEM code as the API keeps it (`VOLKSWAGEN`, `MERCEDES-BENZ`): upper case, trimmed. */
export function manufacturerCode(value: string): string {
  return value.trim().toUpperCase()
}

/** `UNKNOWN`, the API's word for a manufacturer nobody knows, is no manufacturer to show. */
export function knownManufacturer(value: string | null | undefined): string | null {
  return value && value.toUpperCase() !== "UNKNOWN" ? value : null
}

/** The vehicle-aware availability inputs (ADR-029): never a VIN, a registration or a declaration's reason. */
export interface AvailabilityVehicle {
  powertrain: Powertrain
  vehicleClass: VehicleClass
  /** An OEM code: the VIN's when it was decoded, else a declared one; omitted when neither is known. */
  manufacturer?: string
  needsLiveDiagnosis: boolean
}

/** The availability query's vehicle parameters: the powertrain and class always (Unknown included), the rest when set. */
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

/** What free times are counted for: "a battery-electric car", "a heavy vehicle of unknown powertrain, planned as high-voltage". */
export function vehicleQueryPhrase(vehicle: Pick<AvailabilityVehicle, "powertrain" | "vehicleClass" | "needsLiveDiagnosis">): string {
  const noun = classNouns[vehicle.vehicleClass]
  const base =
    vehicle.powertrain === "Unknown"
      ? `a ${noun} of unknown powertrain, planned as high-voltage`
      : `a ${powertrainAdjectives[vehicle.powertrain]} ${noun}`
  return vehicle.needsLiveDiagnosis ? `${base}, with live HV diagnosis` : base
}

/**
 * Whether "Needs live HV diagnosis" applies: a diagnosis or high-voltage service (it needs Diagnostics, an EV bay or the
 * legacy HV certification) on a vehicle that may have a high-voltage system. A petrol or diesel vehicle has none to work on
 * live; a brake job or an MOT is not live working.
 */
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

/**
 * What the vehicle adds to a job, in plain words, for the availability's "no qualified bay and technician" answer, which
 * does not say which need failed: the HV level a vehicle that may be high-voltage needs, a heavy vehicle's lift and
 * certification, and live working's level 4 and EV bay.
 */
export function vehicleNeeds(vehicle: Pick<AvailabilityVehicle, "powertrain" | "vehicleClass" | "needsLiveDiagnosis">): string[] {
  const needs: string[] = []
  if (vehicle.needsLiveDiagnosis) needs.push("an HV level 4 technician and an EV bay, for live working on the high-voltage system")
  else if (mayBeHighVoltage(vehicle.powertrain)) needs.push("a technician with the HV level this service needs on a vehicle that may be high-voltage")
  if (vehicle.vehicleClass === "Heavy") needs.push("a heavy-duty lift and a technician certified for heavy vehicles")
  return needs
}

/**
 * Who declared the vehicle, for people: the API records the audit actor (`user:` and the verified email, `anonymous:` and
 * an address, or `system`), so a signed-in declarer reads as their email; anything else is shown as recorded.
 */
export function declarerName(declaredBy: string): string {
  return declaredBy.startsWith("user:") ? declaredBy.slice("user:".length) : declaredBy
}
