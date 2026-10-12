import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import type { VehicleProfile } from "@/api/types.gen"
import {
  ALLOCATION_CRITERIA,
  explainAllocation,
  hvLevels,
  POWERTRAINS,
  powertrainLabels,
  provenanceLabels,
  reasonExplanations,
  ruleExplanation,
  ruleExplanations,
  VEHICLE_CLASSES,
  vehicleClassLabels,
  whyNot,
} from "@/lib/vehicle-aware"

const web = path.resolve(__dirname, "../..")
const repo = path.resolve(web, "../..")

/** An enum's members as the generated client declares them: `export type Name = 'A' | 'B';`. */
function generatedUnion(name: string): string[] {
  const source = readFileSync(path.join(web, "src/api/types.gen.ts"), "utf8")
  const declaration = new RegExp(`export type ${name} = ([^;]+);`).exec(source)
  if (!declaration) throw new Error(`${name} is not in the generated client`)
  return [...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
}

/** Strings a domain file spells out, by pattern: the API has no enum for reason and rule codes, the domain does. */
function domainCodes(file: string, pattern: RegExp): string[] {
  const source = readFileSync(path.join(repo, "src/Keyloop.ServiceScheduler.Domain/Scheduling", file), "utf8")
  return [...new Set([...source.matchAll(pattern)].map((match) => match[1]))]
}

describe("the vehicle-aware catalogue is complete", () => {
  it("names every allocation criterion of the generated client, for technicians and bays", () => {
    const criteria = generatedUnion("AllocationCriterion")
    expect(criteria.length).toBeGreaterThan(0)
    expect([...ALLOCATION_CRITERIA].sort()).toEqual([...criteria].sort())
    for (const criterion of criteria) {
      const sentence = explainAllocation({
        allocation: { decidedBy: criterion as never, bayDecidedBy: criterion as never, minimumHvLevel: 0, firedRules: [] },
        technician: "Amelia Clarke",
        bay: "Bay 1",
        service: undefined,
        profile: null,
      })
      expect(sentence.technician).toMatch(/^Amelia Clarke: .+\.$/)
      expect(sentence.bay).toMatch(/^Bay 1: .+\.$/)
    }
  })

  it("labels every powertrain, vehicle class and provenance of the generated client", () => {
    expect([...POWERTRAINS].sort()).toEqual(generatedUnion("Powertrain").sort())
    expect(Object.keys(powertrainLabels).sort()).toEqual(generatedUnion("Powertrain").sort())
    expect([...VEHICLE_CLASSES].sort()).toEqual(generatedUnion("VehicleClass").sort())
    expect(Object.keys(vehicleClassLabels).sort()).toEqual(generatedUnion("VehicleClass").sort())
    expect(Object.keys(provenanceLabels).sort()).toEqual(generatedUnion("ProfileSource").sort())
    // The request's powertrain and class are inline unions of the same names.
    expect(POWERTRAINS[0]).toBe("Unknown")
    expect(VEHICLE_CLASSES[0]).toBe("Unknown")
  })

  it("words every rule code the default policy and the legacy component floor can fire", () => {
    const policy = domainCodes("RequirementRule.cs", /Rule\("([a-z-]+)"/g)
    const legacy = domainCodes("RequirementResolver.cs", /LegacyHvComponentRule = "([a-z-]+)"/g)
    expect(policy).toEqual(["hv-awareness", "hv-routine", "hv-aircon", "hv-components", "heavy-vehicle", "hv-live-diagnosis"])
    expect(Object.keys(ruleExplanations).sort()).toEqual([...legacy, ...policy].sort())
    // A dealership's own rule is still named, never dropped.
    expect(ruleExplanation("wash-bay-only")).toBe("the workshop's rule wash-bay-only applies")
  })

  it("explains every reason code the allocation policy can give for a preference it did not follow", () => {
    const codes = domainCodes("AllocationPolicy.cs", /"(preferred-(?:bay|technician):[a-z-]+)"/g)
    expect(codes).toHaveLength(10)
    expect(Object.keys(reasonExplanations).sort()).toEqual([...codes].sort())
    for (const code of codes) {
      const sentence = whyNot(code, { bay: "Bay 2", technician: "Chloe Nguyen", minimumHvLevel: 2 })
      expect(sentence).toMatch(code.startsWith("preferred-bay") ? /^Bay 2 / : /^Chloe Nguyen/)
      expect(sentence).not.toContain(code)
    }
    // A code added later is still said.
    expect(whyNot("preferred-technician:on-holiday", { bay: null, technician: "Farid Haddad", minimumHvLevel: 0 })).toBe(
      "Farid Haddad wasn't chosen (preferred-technician:on-holiday)."
    )
  })

  it("describes the five IMI-style levels", () => {
    expect(Object.keys(hvLevels)).toEqual(["0", "1", "2", "3", "4"])
  })
})

const declaredElectric: VehicleProfile = {
  powertrain: "BatteryElectric",
  manufacturer: "VOLKSWAGEN",
  vehicleClass: "Car",
  provenance: { powertrain: "Declared", manufacturer: "VinDecoded", vehicleClass: "Declared", declaredBy: null, declarationReason: null },
}

describe("an allocation, explained in one sentence", () => {
  it("says who, the deciding comparison, the HV level and skills it needed, and for what vehicle (the ADR's example)", () => {
    const explained = explainAllocation({
      allocation: { decidedBy: "OnlyQualifiedResource", bayDecidedBy: "OnlyQualifiedResource", minimumHvLevel: 3, firedRules: ["legacy-hv-component", "hv-components"] },
      technician: "Ben Okafor",
      bay: "Bay 4 - EV",
      service: { requiredCertifications: ["HighVoltageElectrical", "Diagnostics"], requiredBayCapabilities: ["EvHighVoltage"] },
      profile: declaredElectric,
    })

    expect(explained.technician).toBe(
      "Ben Okafor: the only free technician at HV level 3 or above with Diagnostics, for a battery-electric vehicle (declared)."
    )
    expect(explained.bay).toBe("Bay 4 - EV: the only free bay with EV high voltage.")
    expect(explained.because).toEqual([
      "the service works on high-voltage components, whatever the powertrain",
      "high-voltage component work needs the system switched off, in an EV bay",
    ])
  })

  it("names the heavy-vehicle rule's needs on a heavy van and words an Unknown powertrain as treated high-voltage", () => {
    const explained = explainAllocation({
      allocation: { decidedBy: "LowestLoad", bayDecidedBy: "SurplusCompetences", minimumHvLevel: 2, firedRules: ["hv-routine", "heavy-vehicle"] },
      technician: "Daniel Moss",
      bay: "Bay 3 - Heavy duty",
      service: { requiredCertifications: ["Brakes"], requiredBayCapabilities: ["StandardLift"] },
      profile: { ...declaredElectric, powertrain: "Unknown", vehicleClass: "Heavy", provenance: { ...declaredElectric.provenance, powertrain: "Unknown" } },
    })

    expect(explained.technician).toBe(
      "Daniel Moss: of the free technicians at HV level 2 or above with Brakes and Heavy vehicle, the one with the least work booked that day, for a vehicle whose powertrain isn't known, treated as high-voltage, heavy class."
    )
    expect(explained.bay).toBe(
      "Bay 3 - Heavy duty: of the free bays with Heavy-duty lift, the one with the least extra equipment, keeping specialist bays free."
    )
  })

  it("says the technician asked for was chosen, with no level when the job needed none", () => {
    const explained = explainAllocation({
      allocation: { decidedBy: "PreferredResource", bayDecidedBy: "Name", minimumHvLevel: 0, firedRules: [] },
      technician: "Amelia Clarke",
      bay: "Bay 1 - Standard",
      service: { requiredCertifications: ["GeneralService"], requiredBayCapabilities: ["StandardLift"] },
      profile: { ...declaredElectric, powertrain: "Ice" },
    })

    expect(explained.technician).toBe(
      "Amelia Clarke: the technician you asked for, free and qualified with General service, for a petrol or diesel vehicle (declared)."
    )
    expect(explained.bay).toBe("Bay 1 - Standard: the free bays that fit the job were equally suited and equally busy, so the first by name.")
  })
})

describe("why a preference was not followed", () => {
  it("names the technician from the roster with their level, or the expiry, and the level the job needed", () => {
    expect(
      whyNot("preferred-technician:minimum-hv-level", {
        bay: null,
        technician: "Farid Haddad",
        technicianLevel: { level: 1, validUntil: "2028-12-31" },
        minimumHvLevel: 2,
      })
    ).toBe("Farid Haddad holds HV level 1, below the level 2 this job needs.")
    expect(
      whyNot("preferred-technician:hv-expired", {
        bay: null,
        technician: "Eva Lindqvist",
        technicianLevel: { level: 3, validUntil: "2026-10-12" },
        minimumHvLevel: 3,
        formatDate: () => "12 October 2026",
      })
    ).toBe("Eva Lindqvist's HV level was valid until 12 October 2026, before the appointment's date.")
    expect(whyNot("preferred-bay:busy", { bay: null, technician: null, minimumHvLevel: 0 })).toBe("The bay you asked for was busy at that time.")
  })
})

describe("the vehicle-aware availability inputs", () => {
  it("say what the free times are counted for", async () => {
    const { vehicleQueryPhrase } = await import("@/lib/vehicle-aware")
    expect(vehicleQueryPhrase({ powertrain: "Unknown", vehicleClass: "Unknown", needsLiveDiagnosis: false })).toBe(
      "a vehicle of unknown powertrain, planned as high-voltage"
    )
    expect(vehicleQueryPhrase({ powertrain: "BatteryElectric", vehicleClass: "Car", needsLiveDiagnosis: true })).toBe(
      "a battery-electric car, with live HV diagnosis"
    )
    expect(vehicleQueryPhrase({ powertrain: "Ice", vehicleClass: "Heavy", needsLiveDiagnosis: false })).toBe("a petrol or diesel heavy vehicle")
  })

  it("offer live HV diagnosis only for a diagnosis or high-voltage service on a vehicle that may be high-voltage", async () => {
    const { liveDiagnosisApplies } = await import("@/lib/vehicle-aware")
    const diagnosis = { requiredBayCapabilities: ["Diagnostics"], requiredCertifications: ["Diagnostics"] }
    const charging = { requiredBayCapabilities: ["EvHighVoltage"], requiredCertifications: ["HighVoltageElectrical", "Diagnostics"] }
    const brakes = { requiredBayCapabilities: ["StandardLift"], requiredCertifications: ["Brakes"] }
    expect(liveDiagnosisApplies(diagnosis, "Unknown")).toBe(true)
    expect(liveDiagnosisApplies(charging, "BatteryElectric")).toBe(true)
    expect(liveDiagnosisApplies(diagnosis, "Ice")).toBe(false)
    expect(liveDiagnosisApplies(brakes, "BatteryElectric")).toBe(false)
    expect(liveDiagnosisApplies(undefined, "Unknown")).toBe(false)
  })
})

describe("who declared the vehicle", () => {
  it("reads the audit actor of a signed-in declarer as their email, and anything else as recorded", async () => {
    const { declarerName } = await import("@/lib/vehicle-aware")
    expect(declarerName("user:advisor@keyloop.test")).toBe("advisor@keyloop.test")
    expect(declarerName("system")).toBe("system")
  })
})
