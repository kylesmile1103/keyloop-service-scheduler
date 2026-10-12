import type { ServiceTypeResponse, TriageUncoveredCategory } from "@/api/types.gen"

/**
 * The fixed words for a further problem the description mentioned (Task 32a's closed vocabulary, ARCHITECTURE §8.10): the
 * API sends only the category, and the screen says it in these client-owned words, never in the model's. `satisfies`
 * keeps the table complete for the generated union; `triage-copy.test.ts` checks the same against `types.gen.ts`.
 */
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
