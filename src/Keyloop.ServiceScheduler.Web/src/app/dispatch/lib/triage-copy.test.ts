import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import type { ServiceTypeResponse, TriageUncoveredCategory } from "@/api/types.gen"
import { diagnosticsServiceType } from "@/test/triage"

import { inspectionService, phraseOf, uncoveredPhrases } from "./triage-copy"

const web = path.resolve(__dirname, "../../../..")

/** An enum's members as the generated client declares them: `export type Name = 'A' | 'B';`. */
function generatedUnion(name: string): string[] {
  const source = readFileSync(path.join(web, "src/api/types.gen.ts"), "utf8")
  const declaration = new RegExp(`export type ${name} = ([^;]+);`).exec(source)
  if (!declaration) throw new Error(`${name} is not in the generated client`)
  return [...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
}

describe("the fixed phrases for what else a description mentioned (Task 32a's closed vocabulary)", () => {
  it("has exactly one phrase for every category of the generated client", () => {
    const categories = generatedUnion("TriageUncoveredCategory")
    expect(categories.length).toBeGreaterThan(0)
    // NONE is the request's word for "nothing else": the API answers null instead, so the client never needs a phrase for it.
    expect(categories).not.toContain("NONE")
    expect(Object.keys(uncoveredPhrases).sort()).toEqual([...categories].sort())
  })

  it("keeps the agreed words, in lower case so they sit inside a sentence", () => {
    expect(uncoveredPhrases).toEqual({
      ACCIDENT_OR_BODY_DAMAGE: "accident or body damage",
      LIGHTS_OR_ELECTRICAL_ACCESSORY: "lights or electrical accessories",
      AIR_CONDITIONING: "air conditioning",
      TYRES_OR_WHEELS: "tyres, wheels or suspension",
      GLASS: "glass damage",
      OTHER: "another vehicle issue",
    })
    for (const phrase of Object.values(uncoveredPhrases)) {
      expect(phrase).toBe(phrase.toLowerCase())
      expect(phrase).not.toMatch(/[—.]/)
    }
  })

  it("never shows a category it does not know, but the general phrase", () => {
    expect(phraseOf("SEATBELTS" as TriageUncoveredCategory)).toBe("another vehicle issue")
  })

})

describe("the inspection offered after a no-match", () => {
  const assessment: ServiceTypeResponse = { ...diagnosticsServiceType, id: "assessment", code: "ACCIDENT-DAMAGE-ASSESSMENT", name: "Accident Damage Assessment" }

  it("is the catalogue's Diagnostic Fault Finding, found by its code, when this dealership can book it", () => {
    expect(inspectionService([assessment, diagnosticsServiceType])).toBe(diagnosticsServiceType)
    // Renamed in the catalogue: still the inspection, by its code, under the catalogue's name.
    const renamed = { ...diagnosticsServiceType, name: "Fault Diagnosis" }
    expect(inspectionService([renamed])).toBe(renamed)
  })

  it("is not offered when the dealership cannot book it, or before its services are known", () => {
    expect(inspectionService([assessment, { ...diagnosticsServiceType, bookable: false }])).toBeNull()
    expect(inspectionService([assessment])).toBeNull()
    expect(inspectionService(undefined)).toBeNull()
  })
})
