import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import type { ServiceTypeResponse, TriageUncoveredCategory } from "@/api/types.gen"
import { diagnosticsServiceType } from "@/test/triage"

import { alsoMentioned, inspectionService, noticeApplies, notesLine, notesTooLong, phraseOf, uncoveredPhrases } from "./triage-copy"

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
      expect(phrase).not.toMatch(/[\u2014.]/)
    }
  })

  it("never shows a category it does not know, but the general phrase", () => {
    expect(phraseOf("SEATBELTS" as TriageUncoveredCategory)).toBe("another vehicle issue")
  })

  it("writes the notice, naming the service it is outside when that is known", () => {
    expect(alsoMentioned("ACCIDENT_OR_BODY_DAMAGE", null)).toBe(
      "Also mentioned: accident or body damage. One appointment books one service: add it to Notes or book it separately."
    )
    expect(alsoMentioned("ACCIDENT_OR_BODY_DAMAGE", "Diagnostic Fault Finding")).toBe(
      "Also mentioned: accident or body damage, which Diagnostic Fault Finding does not cover. One appointment books one service: add it to Notes or book it separately."
    )
    expect(notesLine("AIR_CONDITIONING")).toBe("Also mentioned: air conditioning.")
  })

  it("says by how much Notes must be shortened when the line does not fit, in the words of the notes rule", () => {
    expect(notesTooLong(1)).toBe("Notes must be shortened by 1 character to add this line. Notes can be at most 1000 characters.")
    expect(notesTooLong(41)).toBe("Notes must be shortened by 41 characters to add this line. Notes can be at most 1000 characters.")
  })

  it("belongs beside the service it is outside, or beside any choice when that is not known", () => {
    const issue = { category: "GLASS" as const, probability: 0.8, confidence: 0.7, outsideServiceTypeId: "diag" }
    expect(noticeApplies(issue, "diag")).toBe(true)
    // Nothing chosen yet (a confirm): the notice says which service the issue is outside.
    expect(noticeApplies(issue, null)).toBe(true)
    expect(noticeApplies(issue, "brakes")).toBe(false)
    expect(noticeApplies({ ...issue, outsideServiceTypeId: null }, "brakes")).toBe(true)
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
