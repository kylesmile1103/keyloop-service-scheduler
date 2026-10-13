import type { ServiceTypeResponse } from "@/api/types.gen"

/** Seeded service catalogue with deterministic IDs and per-dealership `bookable` flags. */
const catalogue: ReadonlyArray<Omit<ServiceTypeResponse, "bookable">> = [
  {
    id: "651b016b-c559-8313-9f1c-d22ecd706059",
    code: "ACCIDENT-DAMAGE-ASSESSMENT",
    name: "Accident Damage Assessment",
    durationMinutes: 60,
    requiredBayCapabilities: ["StandardLift"],
    requiredCertifications: ["DamageAssessment"],
  },
  {
    id: "c45da81b-7ca9-85dc-b60e-a3af8edf6ee4",
    code: "AIRCON-REGAS",
    name: "Air-Con Regas",
    durationMinutes: 60,
    requiredBayCapabilities: ["AirConditioning"],
    requiredCertifications: ["AirConditioning"],
  },
  {
    id: "6e2d3b26-4420-8a8c-8887-c623cc021e6f",
    code: "BRAKES-PADS-DISCS",
    name: "Brake Pads & Discs",
    durationMinutes: 90,
    requiredBayCapabilities: ["StandardLift"],
    requiredCertifications: ["Brakes"],
  },
  {
    id: "d6a338d4-79ae-8409-988d-97397cca4b3f",
    code: "DIAG-FAULT-FINDING",
    name: "Diagnostic Fault Finding",
    durationMinutes: 60,
    requiredBayCapabilities: ["Diagnostics"],
    requiredCertifications: ["Diagnostics"],
  },
  {
    id: "0d3f160b-2ac4-809a-9309-5966c4ad428c",
    code: "EV-BATTERY-CHECK",
    name: "EV Battery Health Check",
    durationMinutes: 60,
    requiredBayCapabilities: ["EvHighVoltage"],
    requiredCertifications: ["HighVoltageElectrical"],
  },
  {
    id: "30901f53-b735-8f67-9ab0-82040703aa2b",
    code: "EV-CHARGING-FAULT",
    name: "EV Charging Fault Diagnosis",
    durationMinutes: 90,
    requiredBayCapabilities: ["EvHighVoltage"],
    requiredCertifications: ["HighVoltageElectrical", "Diagnostics"],
  },
  {
    id: "5ec2a365-efac-879d-b65f-d789a66389b6",
    code: "WHEEL-ALIGNMENT",
    name: "Four-Wheel Alignment",
    durationMinutes: 45,
    requiredBayCapabilities: ["WheelAlignment"],
    requiredCertifications: ["WheelAlignment"],
  },
  {
    id: "1acd5076-5aa2-88db-8fae-d926839ed944",
    code: "FULL-SERVICE",
    name: "Full Service",
    durationMinutes: 120,
    requiredBayCapabilities: ["StandardLift"],
    requiredCertifications: ["GeneralService"],
  },
  {
    id: "b6619d0a-8bfe-831e-9f85-41b9c03934f6",
    code: "HEAVY-VAN-SERVICE",
    name: "Heavy Van Service",
    durationMinutes: 180,
    requiredBayCapabilities: ["HeavyDutyLift"],
    requiredCertifications: ["HeavyVehicle"],
  },
  {
    id: "3153f30d-5700-8f07-a25d-4a4ea44dfeef",
    code: "INTERIM-SERVICE",
    name: "Interim Service",
    durationMinutes: 60,
    requiredBayCapabilities: ["StandardLift"],
    requiredCertifications: ["GeneralService"],
  },
  {
    id: "fa45a0ee-5368-8a58-8462-affc644362c5",
    code: "MOT-TEST",
    name: "MOT Test",
    durationMinutes: 45,
    requiredBayCapabilities: ["MotTesting"],
    requiredCertifications: ["MotTester"],
  },
]

const munichBookable = new Set(["ACCIDENT-DAMAGE-ASSESSMENT", "BRAKES-PADS-DISCS", "EV-BATTERY-CHECK", "FULL-SERVICE", "HEAVY-VAN-SERVICE", "INTERIM-SERVICE"])

/** Reading's catalogue: every service can be booked there. */
export const readingCatalogue: ServiceTypeResponse[] = catalogue.map((service) => ({ ...service, bookable: true }))

/** München's catalogue, six of the eleven bookable. */
export const munichCatalogue: ServiceTypeResponse[] = catalogue.map((service) => ({ ...service, bookable: munichBookable.has(service.code) }))
