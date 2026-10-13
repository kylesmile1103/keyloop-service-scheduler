import type {
  AllocationDecision,
  FeatureSwitchesResponse,
  ServiceTypeResponse,
  VehicleProfile,
  WorkshopScheduleResponse,
} from "@/api/types.gen"
import { readingTuesday, technicians } from "@/test/schedules"

export const vehicleAwareOn: FeatureSwitchesResponse = { vehicleAwareRequirements: true }
export const vehicleAwareOff: FeatureSwitchesResponse = { vehicleAwareRequirements: false }

/** `POST /vehicle-profiles/resolve` for a WVW VIN: the manufacturer from the VIN, powertrain and class not in it. */
export const decodedVolkswagen: VehicleProfile = {
  powertrain: "Unknown",
  manufacturer: "VOLKSWAGEN",
  vehicleClass: "Unknown",
  provenance: { powertrain: "Unknown", manufacturer: "VinDecoded", vehicleClass: "Unknown", declaredBy: null, declarationReason: null },
}

/** The same for a WDD VIN: Mercedes-Benz. */
export const decodedMercedes: VehicleProfile = { ...decodedVolkswagen, manufacturer: "MERCEDES-BENZ" }

/** The same for a VIN whose first three characters the API does not know. */
export const undecoded: VehicleProfile = {
  powertrain: "Unknown",
  manufacturer: "UNKNOWN",
  vehicleClass: "Unknown",
  provenance: { powertrain: "Unknown", manufacturer: "Unknown", vehicleClass: "Unknown", declaredBy: null, declarationReason: null },
}

export const diagnosticsService: ServiceTypeResponse = {
  id: "d6a338d4-79ae-8409-988d-97397cca4b3f",
  code: "DIAG-FAULT-FINDING",
  name: "Diagnostic Fault Finding",
  durationMinutes: 60,
  requiredBayCapabilities: ["Diagnostics"],
  requiredCertifications: ["Diagnostics"],
  bookable: true,
}

export const evChargingService: ServiceTypeResponse = {
  id: "30901f53-b735-8f67-9ab0-82040703aa2b",
  code: "EV-CHARGING-FAULT",
  name: "EV Charging Fault Diagnosis",
  durationMinutes: 90,
  requiredBayCapabilities: ["EvHighVoltage"],
  requiredCertifications: ["HighVoltageElectrical", "Diagnostics"],
  bookable: true,
}

export const assessmentService: ServiceTypeResponse = {
  id: "651b016b-c559-8313-9f1c-d22ecd706059",
  code: "ACCIDENT-DAMAGE-ASSESSMENT",
  name: "Accident Damage Assessment",
  durationMinutes: 60,
  requiredBayCapabilities: ["StandardLift"],
  requiredCertifications: ["DamageAssessment"],
  bookable: true,
}

/** An allocation as a vehicle-aware booking answers it. */
export function allocation(overrides: Partial<AllocationDecision> = {}): AllocationDecision {
  return {
    decidedBy: "SurplusCompetences",
    bayDecidedBy: "SurplusCompetences",
    policyVersion: 1,
    minimumHvLevel: 2,
    firedRules: ["hv-routine"],
    reasons: [],
    preferredBayId: null,
    preferredTechnicianId: null,
    ...overrides,
  }
}

/** Seeded confirmed HV competence levels and brand specialisms valid through 2028-12-31. */
const seededLevels: Record<string, { hvLevel: number; brands: string[] }> = {
  [technicians.amelia.id]: { hvLevel: 2, brands: ["VOLKSWAGEN"] },
  [technicians.ben.id]: { hvLevel: 3, brands: ["VOLKSWAGEN"] },
  [technicians.chloe.id]: { hvLevel: 2, brands: ["VOLKSWAGEN"] },
  [technicians.daniel.id]: { hvLevel: 2, brands: ["VOLKSWAGEN"] },
  [technicians.eva.id]: { hvLevel: 3, brands: ["VOLKSWAGEN"] },
  [technicians.farid.id]: { hvLevel: 1, brands: ["VOLKSWAGEN"] },
}

/** Reading's Tuesday with each technician's competence, as the switch on and a role see it. */
export const readingTuesdayWithCompetence: WorkshopScheduleResponse = {
  ...readingTuesday,
  technicians: readingTuesday.technicians.map((technician) => ({
    ...technician,
    hvLevel: seededLevels[technician.id].hvLevel,
    hvLevelValidUntil: "2028-12-31",
    hvLevelConfirmed: true,
    brandSpecialisms: seededLevels[technician.id].brands,
  })),
}

const problems = "https://api.keyloop.example/problems/"

/** Reading's EV Battery Health Check: an EV bay and a high-voltage-certified technician (the seeded catalogue). */
export const evBatteryService: ServiceTypeResponse = {
  id: "0d3f160b-2ac4-809a-9309-5966c4ad428c",
  code: "EV-BATTERY-CHECK",
  name: "EV Battery Health Check",
  durationMinutes: 60,
  requiredBayCapabilities: ["EvHighVoltage"],
  requiredCertifications: ["HighVoltageElectrical"],
  bookable: true,
}

const noQualifiedResources = (members: {
  missingCapabilities: string[]
  missingCertifications: string[]
  minimumHvLevel: number
  firedRules: string[]
  traceId: string
}) => ({
  type: `${problems}no-qualified-resources`,
  title: "No qualified resources",
  status: 422,
  detail: "This dealership has no active bay with every capability, or no active technician with every certification, that the service requires.",
  requiredBrand: null,
  ...members,
})

/** Live diagnosis at Reading where no technician holds HV level 4. */
export const liveDiagnosisGap = noQualifiedResources({
  traceId: "00-7a1c2b3d4e5f60718293a4b5c6d7e8f9-1a2b3c4d5e6f7a8b-01",
  minimumHvLevel: 4,
  firedRules: ["hv-routine", "hv-live-diagnosis"],
  missingCapabilities: [],
  missingCertifications: [],
})

/** EV bay out of service while technicians hold valid HV level 3. */
export const equipmentGap = noQualifiedResources({
  traceId: "00-13015a34ed8f1339a903ecb4a0b0128e-1591550a151c83e7-01",
  minimumHvLevel: 3,
  firedRules: ["legacy-hv-component", "hv-components"],
  missingCapabilities: ["EvHighVoltage"],
  missingCertifications: [],
})

/** No active technician holds the high-voltage certification, while the EV bay is in use. */
export const certificationGap = noQualifiedResources({
  traceId: "00-2b3c4d5e6f708192a3b4c5d6e7f80912-3c4d5e6f7a8b9c0d-01",
  minimumHvLevel: 3,
  firedRules: ["legacy-hv-component", "hv-components"],
  missingCapabilities: [],
  missingCertifications: ["HighVoltageElectrical"],
})

/** Neither the EV bay nor a high-voltage-certified technician. */
export const equipmentAndCertificationGap = noQualifiedResources({
  traceId: "00-3c4d5e6f708192a3b4c5d6e7f8091a2b-4d5e6f7a8b9c0d1e-01",
  minimumHvLevel: 3,
  firedRules: ["legacy-hv-component", "hv-components"],
  missingCapabilities: ["EvHighVoltage"],
  missingCertifications: ["HighVoltageElectrical"],
})

export const profileConflict = {
  type: `${problems}vehicle-profile-conflict`,
  title: "Vehicle profile conflict",
  status: 422,
  detail: "Declared and decoded manufacturer disagree. Choose UseDecoded explicitly to continue.",
  traceId: "00-0f1e2d3c4b5a69788796a5b4c3d2e1f0-0a1b2c3d4e5f6a7b-01",
  conflictingAttributes: ["manufacturer"],
}

export const vehicleAwareDisabled = (rejectedFields: string[]) => ({
  type: `${problems}vehicle-aware-requirements-disabled`,
  title: "Vehicle-aware requirements disabled",
  status: 422,
  detail:
    "Vehicle-aware requirements are disabled in this deployment, so the vehicle profile and live-diagnosis inputs cannot be honoured. Omit them to use the service's standard qualification.",
  traceId: "00-1b2c3d4e5f60718293a4b5c6d7e8f901-2b3c4d5e6f7a8b9c-01",
  rejectedFields,
})
