import type {
  BookingTriageStatusResponse,
  ServiceTypeResponse,
  TriageBookingResponse,
  TriagePreferredDate,
} from "@/api/types.gen"

/**
 * Booking intake triage as the API answers it (ARCHITECTURE §8.10): the status read, two seeded services to suggest, and
 * answers built from them. The ids and requirements are the seeded catalogue's (ReferenceDataSeed).
 */

/** `GET /booking-triage` with suggestions switched on (the API ships with them off). */
export const triageEnabled: BookingTriageStatusResponse = {
  enabled: true,
  model: "@cf/cloudflare/clef-flash",
  provider: "Clef-flash via Cloudflare AI Gateway",
  maxDescriptionLength: 500,
  imagesEnabled: true,
  maxImages: 4,
  maxImageBytes: 4 * 1024 * 1024,
  maxTotalImageBytes: 8 * 1024 * 1024,
}

/** `GET /booking-triage` as the API ships: suggestions off. */
export const triageDisabled: BookingTriageStatusResponse = { ...triageEnabled, enabled: false }

export const brakesServiceType: ServiceTypeResponse = {
  id: "6e2d3b26-4420-8a8c-8887-c623cc021e6f",
  code: "BRAKES-PADS-DISCS",
  name: "Brake Pads & Discs",
  durationMinutes: 90,
  requiredBayCapabilities: ["StandardLift"],
  requiredCertifications: ["Brakes"],
  bookable: true,
}

export const diagnosticsServiceType: ServiceTypeResponse = {
  id: "d6a338d4-79ae-8409-988d-97397cca4b3f",
  code: "DIAG-FAULT-FINDING",
  name: "Diagnostic Fault Finding",
  durationMinutes: 60,
  requiredBayCapabilities: ["Diagnostics"],
  requiredCertifications: ["Diagnostics"],
  bookable: true,
}

/** A triage answer: the recommendation, its candidates with their probabilities (most likely first) and the day asked for. */
export function triageAnswer(
  recommendation: "suggest" | "confirm" | "no-match",
  candidates: ReadonlyArray<readonly [ServiceTypeResponse, number]>,
  preferredDate: TriagePreferredDate | null = null
): TriageBookingResponse {
  return {
    model: "@cf/cloudflare/clef-flash",
    recommendation,
    serviceConfidence: recommendation === "suggest" ? 0.9 : recommendation === "confirm" ? 0.5 : 0.2,
    services: candidates.map(([service, probability]) => ({
      serviceType: { id: service.id, code: service.code, name: service.name, durationMinutes: service.durationMinutes },
      probability,
    })),
    preferredDate,
    uncoveredIssue: null,
  }
}

/** A chosen day, as `preferredDate`. */
export const askedFor = (date: string): TriagePreferredDate => ({ date, probability: 0.82, confidence: 0.8 })

export const triageUnavailable = {
  type: "https://api.keyloop.example/problems/triage-unavailable",
  title: "Service suggestions unavailable",
  status: 503,
  detail: "Service suggestions are temporarily unavailable. Please select a service manually.",
  instance: "/api/v1/dealerships/45fa64a1-baa9-8c61-b11a-ee9d7572ae3e/booking-triage",
  traceId: "00-6b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e-3c4d5e6f7a8b9c0d-01",
}
