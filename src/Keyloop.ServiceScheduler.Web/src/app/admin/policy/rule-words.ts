import type { PolicyBookabilityChange, Powertrain, RequirementCondition, RequirementRuleInput, ServiceTypeResponse, VehicleClass } from "@/api/types.gen"
import { featureLabel } from "@/lib/features"
import { POWERTRAINS, VEHICLE_CLASSES } from "@/lib/vehicle-aware"

/** Formatting and comparison helpers for requirement policy rules and dry-run previews. */

/** The powertrains that may have a high-voltage system: every one but petrol or diesel, Unknown included. */
export const HV_POWERTRAINS: readonly Powertrain[] = POWERTRAINS.filter((powertrain) => powertrain !== "Ice")

export const conditionLabels: Record<RequirementCondition, string> = {
  ServicePowertrain: "A service on a powertrain",
  VehicleClass: "A vehicle class",
  LiveDiagnosis: "Live HV diagnosis",
}

const classNouns: Record<VehicleClass, string> = {
  Car: "car",
  LightCommercial: "light commercial (van)",
  Heavy: "heavy vehicle",
  Unknown: "vehicle of unknown class",
}

const powertrainAdjectives: Record<Powertrain, string> = {
  Unknown: "unknown",
  Ice: "petrol or diesel",
  MildHybrid: "mild-hybrid",
  FullHybrid: "full-hybrid",
  PluginHybrid: "plug-in hybrid",
  BatteryElectric: "battery-electric",
  FuelCell: "fuel-cell",
}

/** "a, b and c" */
export function joinWords(words: readonly string[], last = "and"): string {
  if (words.length <= 1) return words[0] ?? ""
  return `${words.slice(0, -1).join(", ")} ${last} ${words[words.length - 1]}`
}

const sameSet = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((value) => b.includes(value))

/** The powertrains in the order a sentence names them: the known ones first, Unknown last. */
const PHRASE_ORDER: readonly Powertrain[] = [...POWERTRAINS.filter((powertrain) => powertrain !== "Unknown"), "Unknown"]

/** "a battery-electric ...", "an unknown ...". */
const withArticle = (phrase: string) => `${/^[aeiou]/i.test(phrase) ? "an" : "a"} ${phrase}`

/** Powertrains as one adjective list: "battery-electric or unknown". */
const powertrainList = (powertrains: readonly Powertrain[]) =>
  joinWords(PHRASE_ORDER.filter((powertrain) => powertrains.includes(powertrain)).map((powertrain) => powertrainAdjectives[powertrain]), "or")

/** The powertrains of a rule in words: "a vehicle that may be high-voltage", "a battery-electric or unknown powertrain". */
function powertrainWords(powertrains: readonly Powertrain[]): string {
  if (sameSet(powertrains, POWERTRAINS)) return "any powertrain"
  if (sameSet(powertrains, HV_POWERTRAINS)) return "a vehicle that may be high-voltage"
  return withArticle(`${powertrainList(powertrains)} powertrain`)
}

const capitalised = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

/** A service code's name from the catalogue, or the code itself. */
export function serviceName(code: string, services: readonly ServiceTypeResponse[] | undefined): string {
  return services?.find((service) => service.code === code)?.name ?? code
}

/** When a rule applies: "Interim Service and Full Service, on a vehicle that may be high-voltage", "A heavy vehicle". */
export function whenWords(rule: RequirementRuleInput, services: readonly ServiceTypeResponse[] | undefined): string {
  switch (rule.condition) {
    case "ServicePowertrain":
      return `${joinWords(rule.serviceCodes.map((code) => serviceName(code, services)))}, on ${powertrainWords(rule.powertrains)}`
    case "VehicleClass":
      return rule.vehicleClass ? capitalised(withArticle(classNouns[rule.vehicleClass])) : "A vehicle class (none chosen)"
    case "LiveDiagnosis":
      return "Live HV diagnosis"
  }
}

/** What a rule adds, in words: "HV 3, EV high voltage", "Heavy-duty lift, Heavy vehicle", "Nothing". */
export function needsWords(rule: Pick<RequirementRuleInput, "minimumHvLevel" | "bayCapabilities" | "certifications">): string {
  const needs = [
    ...(rule.minimumHvLevel > 0 ? [`HV ${rule.minimumHvLevel}`] : []),
    ...rule.bayCapabilities.map(featureLabel),
    ...rule.certifications.map(featureLabel),
  ]
  return needs.length > 0 ? needs.join(", ") : "Nothing more"
}

/** A rule in one line, for a comparison: when it applies and what it needs. */
export function ruleSummary(rule: RequirementRuleInput | undefined, services: readonly ServiceTypeResponse[] | undefined): string {
  return rule ? `${whenWords(rule, services)}: ${needsWords(rule)}` : "No such rule"
}

/** Rules in the order the API evaluates them: by order, then by code. */
export function inOrder(rules: readonly RequirementRuleInput[]): RequirementRuleInput[] {
  return [...rules].sort((a, b) => a.order - b.order || a.code.localeCompare(b.code))
}

/** A rule as a stable string, to compare two versions of it (lists as sets). */
function fingerprint(rule: RequirementRuleInput): string {
  const sorted = (values: readonly string[]) => [...values].sort().join(",")
  return [
    rule.order,
    rule.condition,
    sorted(rule.powertrains),
    sorted(rule.serviceCodes),
    rule.vehicleClass ?? "",
    rule.minimumHvLevel,
    sorted(rule.bayCapabilities),
    sorted(rule.certifications),
  ].join("|")
}

export const sameRule = (a: RequirementRuleInput | undefined, b: RequirementRuleInput | undefined) =>
  a === b || (a !== undefined && b !== undefined && fingerprint(a) === fingerprint(b))

/** A rule's state between two versions. */
export type RuleChange = "added" | "removed" | "changed"

/** How each rule (by code) differs from one version to the next; rules that did not change are left out. */
export function ruleChanges(before: readonly RequirementRuleInput[], after: readonly RequirementRuleInput[]): Map<string, RuleChange> {
  const changes = new Map<string, RuleChange>()
  const old = new Map(before.map((rule) => [rule.code, rule]))
  const next = new Map(after.map((rule) => [rule.code, rule]))
  for (const [code, rule] of next) {
    if (!old.has(code)) changes.set(code, "added")
    else if (!sameRule(old.get(code), rule)) changes.set(code, "changed")
  }
  for (const code of old.keys()) if (!next.has(code)) changes.set(code, "removed")
  return changes
}

/** What changed in one rule, in words: "HV 2 to HV 4", "services: Air-Con Regas added". */
export function ruleChangeWords(
  before: RequirementRuleInput | undefined,
  after: RequirementRuleInput | undefined,
  services: readonly ServiceTypeResponse[] | undefined
): string {
  if (!before && after) return `added: ${ruleSummary(after, services)}`
  if (before && !after) return "removed"
  if (!before || !after) return ""
  const parts: string[] = []
  if (before.minimumHvLevel !== after.minimumHvLevel) {
    parts.push(`${before.minimumHvLevel === 0 ? "no HV level" : `HV ${before.minimumHvLevel}`} to ${after.minimumHvLevel === 0 ? "no HV level" : `HV ${after.minimumHvLevel}`}`)
  }
  if (whenWords(before, services) !== whenWords(after, services)) parts.push(`applies to ${whenWords(after, services)}`)
  if (needsWords({ ...before, minimumHvLevel: 0 }) !== needsWords({ ...after, minimumHvLevel: 0 })) {
    parts.push(`needs ${needsWords({ ...after, minimumHvLevel: 0 }).replace("Nothing more", "no equipment or certification")}`)
  }
  if (before.order !== after.order) parts.push(`order ${before.order} to ${after.order}`)
  return parts.join("; ")
}

/** Rebases a local rule draft onto a newly published policy version. */
export function carriedOnto(
  opened: readonly RequirementRuleInput[],
  published: readonly RequirementRuleInput[],
  mine: readonly RequirementRuleInput[]
): RequirementRuleInput[] {
  const changes = ruleChanges(opened, mine)
  const result = new Map(published.map((rule) => [rule.code, rule]))
  for (const [code, change] of changes) {
    if (change === "removed") result.delete(code)
    else result.set(code, mine.find((rule) => rule.code === code)!)
  }
  return inOrder([...result.values()])
}

/** One line of a preview: a service that becomes bookable or not, for which vehicles. */
export interface PreviewLine {
  key: string
  serviceName: string
  becomesBookable: boolean
  /** "for a battery-electric or unknown powertrain, any vehicle class (without live HV diagnosis)" */
  vehicles: string
}

const liveWords = { both: "", live: " (with live HV diagnosis)", plain: " (without live HV diagnosis)" } as const

function classWords(classes: readonly VehicleClass[]): string {
  if (sameSet(classes, VEHICLE_CLASSES)) return "any vehicle class"
  const ordered = [...VEHICLE_CLASSES.filter((vehicleClass) => vehicleClass !== "Unknown"), "Unknown" as const].filter((vehicleClass) => classes.includes(vehicleClass))
  return `as ${withArticle(joinWords(ordered.map((vehicleClass) => classNouns[vehicleClass]), "or"))}`
}

function vehiclesPhrase(powertrains: readonly Powertrain[]): string {
  if (sameSet(powertrains, POWERTRAINS)) return "any powertrain"
  if (sameSet(powertrains, HV_POWERTRAINS)) return "any powertrain that may be high-voltage"
  return withArticle(`${powertrainList(powertrains)} powertrain`)
}

/** Groups dry-run bookability changes into human-readable summary lines by service and direction. */
export function previewLines(changes: readonly PolicyBookabilityChange[], services: readonly ServiceTypeResponse[] | undefined): PreviewLine[] {
  const byService = new Map<string, PolicyBookabilityChange[]>()
  for (const change of changes) {
    const key = `${change.serviceCode}|${change.isBookable}`
    byService.set(key, [...(byService.get(key) ?? []), change])
  }
  const lines: PreviewLine[] = []
  for (const [key, items] of byService) {
    const [code, bookable] = key.split("|")
    // For each powertrain and class, which live modes changed.
    const modes = new Map<string, Set<boolean>>()
    for (const item of items) {
      const cell = `${item.powertrain}|${item.vehicleClass}`
      modes.set(cell, (modes.get(cell) ?? new Set()).add(item.needsLiveDiagnosis))
    }
    // For each powertrain, its classes per live mode; then powertrains with the same classes and mode share a line.
    const groups = new Map<string, Powertrain[]>()
    for (const powertrain of POWERTRAINS) {
      const byMode = new Map<keyof typeof liveWords, VehicleClass[]>()
      for (const vehicleClass of VEHICLE_CLASSES) {
        const live = modes.get(`${powertrain}|${vehicleClass}`)
        if (!live) continue
        const mode = live.size === 2 ? "both" : live.has(true) ? "live" : "plain"
        byMode.set(mode, [...(byMode.get(mode) ?? []), vehicleClass])
      }
      for (const [mode, classes] of byMode) {
        const group = `${mode}|${classes.join(",")}`
        groups.set(group, [...(groups.get(group) ?? []), powertrain])
      }
    }
    for (const [group, powertrains] of groups) {
      const [mode, classes] = group.split("|") as [keyof typeof liveWords, string]
      lines.push({
        key: `${key}|${group}`,
        serviceName: serviceName(code, services),
        becomesBookable: bookable === "true",
        vehicles: `for ${vehiclesPhrase(powertrains)}, ${classWords(classes.split(",") as VehicleClass[])}${liveWords[mode]}`,
      })
    }
  }
  return lines.sort((a, b) => a.serviceName.localeCompare(b.serviceName, "en-GB") || Number(a.becomesBookable) - Number(b.becomesBookable))
}

/** A new rule's starting point: a service rule for every powertrain that may be high-voltage, after the last rule. */
export function blankRule(after: readonly RequirementRuleInput[]): RequirementRuleInput {
  const last = after.reduce((highest, rule) => Math.max(highest, rule.order), 0)
  return {
    code: "",
    order: last + 10,
    condition: "ServicePowertrain",
    powertrains: [],
    serviceCodes: [],
    vehicleClass: null,
    minimumHvLevel: 0,
    bayCapabilities: [],
    certifications: [],
  }
}
