import { describe, expect, it } from "vitest"

import type { PolicyBookabilityChange, RequirementRuleInput } from "@/api/types.gen"
import { defaultRules } from "@/test/admin-api"
import { readingCatalogue } from "@/test/catalogue"

import { carriedOnto, needsWords, previewLines, ruleChanges, ruleChangeWords, whenWords } from "./rule-words"

const rule = (code: string) => defaultRules.find((candidate) => candidate.code === code)!
const withLevel = (code: string, minimumHvLevel: number): RequirementRuleInput => ({ ...rule(code), minimumHvLevel })

const change = (overrides: Partial<PolicyBookabilityChange>): PolicyBookabilityChange => ({
  serviceTypeId: "s",
  serviceCode: "MOT-TEST",
  powertrain: "BatteryElectric",
  vehicleClass: "Car",
  needsLiveDiagnosis: false,
  wasBookable: true,
  isBookable: false,
  ...overrides,
})

describe("the policy's words", () => {
  it("say when a rule applies and what it adds", () => {
    expect(whenWords(rule("hv-aircon"), readingCatalogue)).toBe("Air-Con Regas, on a vehicle that may be high-voltage")
    expect(whenWords({ ...rule("hv-aircon"), powertrains: ["Unknown", "PluginHybrid"] }, readingCatalogue)).toBe(
      "Air-Con Regas, on a plug-in hybrid or unknown powertrain"
    )
    expect(whenWords(rule("heavy-vehicle"), readingCatalogue)).toBe("A heavy vehicle")
    expect(needsWords(rule("hv-components"))).toBe("HV 3, EV high voltage")
    expect(needsWords(rule("heavy-vehicle"))).toBe("Heavy-duty lift, Heavy vehicle")
  })

  it("find each rule that was added, changed or removed, and say how", () => {
    const after = [...defaultRules.filter((candidate) => candidate.code !== "hv-aircon").map((candidate) => (candidate.code === "hv-routine" ? withLevel("hv-routine", 4) : candidate)), { ...rule("hv-awareness"), code: "van-hv" }]
    expect(Object.fromEntries(ruleChanges(defaultRules, after))).toEqual({ "hv-routine": "changed", "hv-aircon": "removed", "van-hv": "added" })
    expect(ruleChangeWords(rule("hv-routine"), withLevel("hv-routine", 4), readingCatalogue)).toBe("HV 2 to HV 4")
    expect(ruleChangeWords(rule("hv-aircon"), undefined, readingCatalogue)).toBe("removed")
  })

  it("carry a draft onto a newer version: the published rules with this Admin's changes on top", () => {
    const published = defaultRules.map((candidate) => (candidate.code === "hv-aircon" ? withLevel("hv-aircon", 4) : candidate))
    const mine = defaultRules.filter((candidate) => candidate.code !== "hv-awareness").map((candidate) => (candidate.code === "hv-routine" ? withLevel("hv-routine", 4) : candidate))

    const carried = carriedOnto(defaultRules, published, mine)

    expect(carried.find((candidate) => candidate.code === "hv-aircon")?.minimumHvLevel).toBe(4)
    expect(carried.find((candidate) => candidate.code === "hv-routine")?.minimumHvLevel).toBe(4)
    expect(carried.some((candidate) => candidate.code === "hv-awareness")).toBe(false)
    expect(carried).toHaveLength(defaultRules.length - 1)
  })

  it("fold a preview's changes into one sentence per service, direction and set of vehicles", () => {
    const changes = [
      ...(["Car", "LightCommercial"] as const).flatMap((vehicleClass) =>
        ([false, true] as const).map((needsLiveDiagnosis) => change({ vehicleClass, needsLiveDiagnosis, powertrain: "BatteryElectric" }))
      ),
      ...(["Car", "LightCommercial"] as const).map((vehicleClass) => change({ vehicleClass, powertrain: "FuelCell", needsLiveDiagnosis: true })),
      change({ serviceCode: "INTERIM-SERVICE", powertrain: "Ice", vehicleClass: "Heavy", wasBookable: false, isBookable: true }),
    ]

    expect(previewLines(changes, readingCatalogue).map((line) => `${line.serviceName} ${line.becomesBookable ? "now" : "no longer"} ${line.vehicles}`)).toEqual([
      "Interim Service now for a petrol or diesel powertrain, as a heavy vehicle (without live HV diagnosis)",
      "MOT Test no longer for a battery-electric powertrain, as a car or light commercial (van)",
      "MOT Test no longer for a fuel-cell powertrain, as a car or light commercial (van) (with live HV diagnosis)",
    ])
  })
})
