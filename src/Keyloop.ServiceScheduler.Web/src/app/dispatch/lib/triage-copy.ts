import type { ServiceTypeResponse, TriageUncoveredCategory, TriageUncoveredIssue } from "@/api/types.gen"

import { NOTES_LIMIT } from "./booking-schema"

/** Client-owned phrases for uncovered issue categories returned by triage. */
export const uncoveredPhrases = {
  ACCIDENT_OR_BODY_DAMAGE: "accident or body damage",
  LIGHTS_OR_ELECTRICAL_ACCESSORY: "lights or electrical accessories",
  AIR_CONDITIONING: "air conditioning",
  TYRES_OR_WHEELS: "tyres, wheels or suspension",
  GLASS: "glass damage",
  OTHER: "another vehicle issue",
} as const satisfies Record<TriageUncoveredCategory, string>

/** A category's phrase; one this client does not know yet reads as the general one, never as its code. */
export function phraseOf(category: TriageUncoveredCategory): string {
  return Object.hasOwn(uncoveredPhrases, category) ? uncoveredPhrases[category] : uncoveredPhrases.OTHER
}

/** The line *Add to Notes* writes into the booking's notes. */
export const notesLine = (category: TriageUncoveredCategory) => `Also mentioned: ${phraseOf(category)}.`

/**
 * Said in the notice when *Add to Notes* would take the notes past their limit, so nothing was written: by how much the
 * notes must be shortened for the line to fit, in the words of the notes rule.
 */
export const notesTooLong = (over: number) =>
  `Notes must be shortened by ${over} ${over === 1 ? "character" : "characters"} to add this line. Notes can be at most ${NOTES_LIMIT} characters.`

/**
 * The notice beside a suggestion: what else the description mentioned, outside the service named when the answer says which
 * one (`outsideServiceTypeId`), and what to do about it.
 */
export function alsoMentioned(category: TriageUncoveredCategory, outsideServiceName: string | null): string {
  const outside = outsideServiceName ? `, which ${outsideServiceName} does not cover` : ""
  return `Also mentioned: ${phraseOf(category)}${outside}. One appointment books one service: add it to Notes or book it separately.`
}

/**
 * Whether the notice belongs beside the candidate chosen: the issue is outside Clef's own service, so it goes when another
 * candidate is chosen; with nothing chosen yet (a `confirm`) it stays and names that service; with no service named
 * (`outsideServiceTypeId: null`), it is outside every one.
 */
export function noticeApplies(issue: TriageUncoveredIssue, chosenServiceTypeId: string | null): boolean {
  return issue.outsideServiceTypeId === null || chosenServiceTypeId === null || chosenServiceTypeId === issue.outsideServiceTypeId
}

/** The catalogue's code for the service that finds what is wrong: the next step offered after a no-match. */
export const INSPECTION_SERVICE_CODE = "DIAG-FAULT-FINDING"

/** The dealership's inspection service, by its code, only while the dealership can book it (and once its services are known). */
export function inspectionService(serviceTypes: readonly ServiceTypeResponse[] | undefined): ServiceTypeResponse | null {
  return serviceTypes?.find((service) => service.code === INSPECTION_SERVICE_CODE && service.bookable) ?? null
}

/** What a no-match says first: plainly, that the bookable services do not cover what was described. */
export const NO_MATCH = "The workshop’s bookable services do not cover what you described."

/** The no-match's next steps after its action (the inspection), or on their own when there is no inspection to offer. */
export const noMatchNextSteps = (inspection: boolean) =>
  inspection ? "You can also choose a service below or contact the workshop." : "Choose a service below, or contact the workshop."

/** The no-match's action: the inspection, by the catalogue's name. */
export const inspectionAction = (service: ServiceTypeResponse) => `Book ${service.name} for an inspection`
