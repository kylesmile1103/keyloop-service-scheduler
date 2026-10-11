import type {
  AppointmentResponse,
  AppointmentStatus,
  AvailabilityResponse,
  ScheduledAppointmentResponse,
  ServiceTypeResponse,
  ServiceTypeSummary,
  WorkshopScheduleResponse,
} from "@/api/types.gen"
import { munich, reading } from "@/test/dealerships"

/**
 * Schedules as the API answers them in Development (captured from GET /api/v1/dealerships/{id}/schedule on the seeded
 * database): Reading on Tuesday 2026-10-13, open 08:00–18:00 BST (07:00–17:00Z), with the demo seeder's six appointments;
 * München the same day, open 07:30–18:30 CEST, with no appointments; and Reading on Sunday 2026-10-18, closed.
 */

const services = {
  interim: { id: "3153f30d-5700-8f07-a25d-4a4ea44dfeef", code: "INTERIM-SERVICE", name: "Interim Service", durationMinutes: 60 },
  full: { id: "1acd5076-5aa2-88db-8fae-d926839ed944", code: "FULL-SERVICE", name: "Full Service", durationMinutes: 120 },
  brakes: { id: "6e2d3b26-4420-8a8c-8887-c623cc021e6f", code: "BRAKES-PADS-DISCS", name: "Brake Pads & Discs", durationMinutes: 90 },
  evBattery: { id: "0d3f160b-2ac4-809a-9309-5966c4ad428c", code: "EV-BATTERY-CHECK", name: "EV Battery Health Check", durationMinutes: 60 },
  mot: { id: "fa45a0ee-5368-8a58-8462-affc644362c5", code: "MOT-TEST", name: "MOT Test", durationMinutes: 45 },
  alignment: { id: "5ec2a365-efac-879d-b65f-d789a66389b6", code: "WHEEL-ALIGNMENT", name: "Four-Wheel Alignment", durationMinutes: 45 },
} satisfies Record<string, ServiceTypeSummary>

export const technicians = {
  amelia: { id: "bd559b63-ceea-83dd-9a48-f2bc7a515dcd", name: "Amelia Clarke" },
  ben: { id: "82e5df3c-7917-88cc-a032-a7b56824ad2f", name: "Ben Okafor" },
  chloe: { id: "9788596e-23c6-8218-b131-522ba9a2e951", name: "Chloe Nguyen" },
  daniel: { id: "1ce0da41-2f43-8af7-af61-ba4bd2f64459", name: "Daniel Moss" },
  eva: { id: "7d5845e4-2fe6-8292-8642-f13fd96b9cf1", name: "Eva Lindqvist" },
  farid: { id: "16c6c01b-e1e3-8582-8202-0232d0b246d0", name: "Farid Haddad" },
}

/** The six seeded appointments, by name. */
export const appointments = {
  /** Bay 1, 08:00–09:00, Amelia Clarke. */
  interim: {
    id: "f5c12fc0-1ccc-8669-92c7-4328418ad88f",
    startUtc: "2026-10-13T07:00:00Z",
    endUtc: "2026-10-13T08:00:00Z",
    startLocal: "2026-10-13T08:00+01:00",
    endLocal: "2026-10-13T09:00+01:00",
    status: "Confirmed",
    serviceType: services.interim,
    technician: technicians.amelia,
    vin: "JTDKN3DU0A0123460",
    registration: "RF20 BCJ",
    customerName: "Sophie Turner",
  },
  /** Bay 1, 10:30–12:00, Chloe Nguyen. */
  brakes: {
    id: "25af6008-e87c-8314-a52a-e75dcdb36fea",
    startUtc: "2026-10-13T09:30:00Z",
    endUtc: "2026-10-13T11:00:00Z",
    startLocal: "2026-10-13T10:30+01:00",
    endLocal: "2026-10-13T12:00+01:00",
    status: "Confirmed",
    serviceType: services.brakes,
    technician: technicians.chloe,
    vin: "TMBJF9NE9N0123462",
    registration: "RK22 OYS",
    customerName: "Emily Clarkson",
  },
  /** Bay 1, 13:00–15:00, Daniel Moss. */
  full: {
    id: "563be161-9ad1-84d0-8391-5f99a6697c31",
    startUtc: "2026-10-13T12:00:00Z",
    endUtc: "2026-10-13T14:00:00Z",
    startLocal: "2026-10-13T13:00+01:00",
    endLocal: "2026-10-13T15:00+01:00",
    status: "Confirmed",
    serviceType: services.full,
    technician: technicians.daniel,
    vin: "WVWZZZ1KZAW123456",
    registration: "RE21 KLM",
    customerName: "Olivia Bennett",
  },
  /** Bay 2, 15:00–15:45, Chloe Nguyen. */
  alignment: {
    id: "1b1edb31-a0ae-8816-9ab8-9885d2f2e825",
    startUtc: "2026-10-13T14:00:00Z",
    endUtc: "2026-10-13T14:45:00Z",
    startLocal: "2026-10-13T15:00+01:00",
    endLocal: "2026-10-13T15:45+01:00",
    status: "Confirmed",
    serviceType: services.alignment,
    technician: technicians.chloe,
    vin: "SB1KZ3JE60E123457",
    registration: "RG19 TPX",
    customerName: "Harry Whitfield",
  },
  /** Bay 4, 09:00–10:00, Ben Okafor. */
  evBattery: {
    id: "d0cd2551-20a4-8e9f-8abd-160e450bd9c9",
    startUtc: "2026-10-13T08:00:00Z",
    endUtc: "2026-10-13T09:00:00Z",
    startLocal: "2026-10-13T09:00+01:00",
    endLocal: "2026-10-13T10:00+01:00",
    status: "Confirmed",
    serviceType: services.evBattery,
    technician: technicians.ben,
    vin: "WF0XXXGCDXDA12346",
    registration: "RE16 HUV",
    customerName: "Mohammed Rahman",
  },
  /** Bay 6, 11:00–11:45, Farid Haddad. */
  mot: {
    id: "3cbaeeaa-b562-81d8-a214-acb605805b8b",
    startUtc: "2026-10-13T10:00:00Z",
    endUtc: "2026-10-13T10:45:00Z",
    startLocal: "2026-10-13T11:00+01:00",
    endLocal: "2026-10-13T11:45+01:00",
    status: "Confirmed",
    serviceType: services.mot,
    technician: technicians.farid,
    vin: "KMHD35LE2EU123463",
    registration: "RO14 GFE",
    customerName: "Jack Davies",
  },
} satisfies Record<string, ScheduledAppointmentResponse>

export const bays = {
  standard: { id: "29c9f970-e13d-879e-a949-a553839cf25e", name: "Bay 1 - Standard" },
  alignment: { id: "e22f5b8b-1e25-8907-8a32-090fe4150c48", name: "Bay 2 - Alignment" },
  heavy: { id: "f1283326-dfc7-8044-a60d-b5f049a977be", name: "Bay 3 - Heavy duty" },
  ev: { id: "9e0ed805-52e8-8a9f-a821-cfb4b9e00f5f", name: "Bay 4 - EV" },
  diagnostics: { id: "4c4ce390-6ad5-8b1a-8ec7-2db273944dbc", name: "Bay 5 - Diagnostics" },
  mot: { id: "9ac2ba12-35a5-84d1-b009-07661ce8b76f", name: "Bay 6 - MOT" },
}

const readingTechnicians: WorkshopScheduleResponse["technicians"] = [
  { ...technicians.amelia, employeeNumber: "T-1001", certifications: ["GeneralService", "Brakes", "MotTester"], isActive: true },
  { ...technicians.ben, employeeNumber: "T-1002", certifications: ["GeneralService", "HighVoltageElectrical", "Diagnostics"], isActive: true },
  { ...technicians.chloe, employeeNumber: "T-1003", certifications: ["GeneralService", "Brakes", "WheelAlignment"], isActive: true },
  { ...technicians.daniel, employeeNumber: "T-1004", certifications: ["GeneralService", "Brakes", "HeavyVehicle"], isActive: true },
  { ...technicians.eva, employeeNumber: "T-1005", certifications: ["GeneralService", "Diagnostics", "AirConditioning"], isActive: true },
  { ...technicians.farid, employeeNumber: "T-1006", certifications: ["GeneralService", "Diagnostics", "MotTester"], isActive: true },
]

/** Reading, Tuesday 2026-10-13. */
export const readingTuesday: WorkshopScheduleResponse = {
  dealership: { id: reading.id, name: reading.name, timeZoneId: reading.timeZoneId },
  date: "2026-10-13",
  operatingWindow: {
    startUtc: "2026-10-13T07:00:00Z",
    endUtc: "2026-10-13T17:00:00Z",
    opensAtLocal: "2026-10-13T08:00+01:00",
    closesAtLocal: "2026-10-13T18:00+01:00",
  },
  slotGranularityMinutes: 15,
  bays: [
    { ...bays.standard, capabilities: ["StandardLift"], isActive: true, appointments: [appointments.interim, appointments.brakes, appointments.full] },
    { ...bays.alignment, capabilities: ["StandardLift", "WheelAlignment"], isActive: true, appointments: [appointments.alignment] },
    { ...bays.heavy, capabilities: ["StandardLift", "HeavyDutyLift"], isActive: true, appointments: [] },
    { ...bays.ev, capabilities: ["StandardLift", "EvHighVoltage"], isActive: true, appointments: [appointments.evBattery] },
    { ...bays.diagnostics, capabilities: ["StandardLift", "Diagnostics", "AirConditioning"], isActive: true, appointments: [] },
    { ...bays.mot, capabilities: ["StandardLift", "MotTesting"], isActive: true, appointments: [appointments.mot] },
  ],
  technicians: readingTechnicians,
}

/** Reading, Sunday 2026-10-18: closed, lanes kept, no appointments. */
export const readingSunday: WorkshopScheduleResponse = {
  ...readingTuesday,
  date: "2026-10-18",
  operatingWindow: null,
  bays: readingTuesday.bays.map((bay) => ({ ...bay, appointments: [] })),
}

/** München, Tuesday 2026-10-13: open 07:30–18:30 CEST, nothing booked. */
export const munichTuesday: WorkshopScheduleResponse = {
  dealership: { id: munich.id, name: munich.name, timeZoneId: munich.timeZoneId },
  date: "2026-10-13",
  operatingWindow: {
    startUtc: "2026-10-13T05:30:00Z",
    endUtc: "2026-10-13T16:30:00Z",
    opensAtLocal: "2026-10-13T07:30+02:00",
    closesAtLocal: "2026-10-13T18:30+02:00",
  },
  slotGranularityMinutes: 15,
  bays: [
    { id: "b6fb62bf-3ee5-81ad-b6f3-3696ec73e7ba", name: "Halle 1", capabilities: ["StandardLift"], isActive: true, appointments: [] },
    { id: "9192572d-5ae1-8a99-a4f0-999f9655a151", name: "Halle 2", capabilities: ["StandardLift", "EvHighVoltage"], isActive: true, appointments: [] },
    { id: "54888268-ea00-897d-80f0-7997cc1f18c7", name: "Halle 3", capabilities: ["StandardLift", "HeavyDutyLift"], isActive: true, appointments: [] },
  ],
  technicians: [
    { id: "023917dc-c695-851d-8646-e0fbd59c5b20", name: "Greta Vogel", employeeNumber: "M-2001", certifications: ["GeneralService", "Brakes"], isActive: true },
    { id: "d6dceec3-2d89-8537-851a-a906dcd1b1fa", name: "Hans Richter", employeeNumber: "M-2002", certifications: ["GeneralService", "HighVoltageElectrical"], isActive: true },
    { id: "5fb2a4be-c4d2-8df1-bdd2-0444adfa5367", name: "Ingrid Bauer", employeeNumber: "M-2003", certifications: ["GeneralService", "Diagnostics", "HeavyVehicle"], isActive: true },
  ],
}

/** A copy of a schedule with one appointment's status changed. */
export function withStatus(
  schedule: WorkshopScheduleResponse,
  appointmentId: string,
  status: AppointmentStatus
): WorkshopScheduleResponse {
  return {
    ...schedule,
    bays: schedule.bays.map((bay) => ({
      ...bay,
      appointments: bay.appointments.map((appointment) =>
        appointment.id === appointmentId ? { ...appointment, status } : appointment
      ),
    })),
  }
}

/** A copy of a schedule without one appointment, as the board reads it after a cancellation. */
export function without(schedule: WorkshopScheduleResponse, appointmentId: string): WorkshopScheduleResponse {
  return {
    ...schedule,
    bays: schedule.bays.map((bay) => ({
      ...bay,
      appointments: bay.appointments.filter((appointment) => appointment.id !== appointmentId),
    })),
  }
}

/** GET /api/v1/appointments/{id} for the 08:00 Interim Service: the whole record behind a board block. */
export const interimDetails: AppointmentResponse = {
  id: appointments.interim.id,
  dealershipId: reading.id,
  serviceType: services.interim,
  bay: bays.standard,
  technician: technicians.amelia,
  startUtc: appointments.interim.startUtc,
  endUtc: appointments.interim.endUtc,
  startLocal: appointments.interim.startLocal,
  endLocal: appointments.interim.endLocal,
  status: "Confirmed",
  customer: { name: "Sophie Turner", email: "sophie.turner@example.com", phone: "+44 7700 900105" },
  vehicle: { vin: "JTDKN3DU0A0123460", registration: "RF20 BCJ", make: "Toyota", model: "Prius" },
  notes: "Customer waiting in the lounge.",
  cancellationReason: null,
  createdAtUtc: "2026-10-11T18:40:19.208365Z",
  updatedAtUtc: "2026-10-11T18:40:19.208365Z",
}

/** The catalogue entry the KPI strip looks up for "next free slot". */
export const interimServiceType: ServiceTypeResponse = {
  ...services.interim,
  requiredBayCapabilities: ["StandardLift"],
  requiredCertifications: ["GeneralService"],
  bookable: true,
}

/** A second catalogue entry, listed before Interim Service in some tests (the KPI strip must still pick Interim Service). */
export const fullServiceType: ServiceTypeResponse = {
  ...services.full,
  requiredBayCapabilities: ["StandardLift"],
  requiredCertifications: ["GeneralService"],
  bookable: true,
}

/** GET availability for Interim Service at Reading on 2026-10-13: the first free start is 10:15 local. */
export const interimAvailability: AvailabilityResponse = {
  date: "2026-10-13",
  timeZoneId: "Europe/London",
  operatingWindow: readingTuesday.operatingWindow,
  durationMinutes: 60,
  slotGranularityMinutes: 15,
  slots: [
    { startUtc: "2026-10-13T09:15:00Z", endUtc: "2026-10-13T10:15:00Z", startLocal: "2026-10-13T10:15+01:00", freeBays: 4, freeTechnicians: 3 },
    { startUtc: "2026-10-13T09:30:00Z", endUtc: "2026-10-13T10:30:00Z", startLocal: "2026-10-13T10:30+01:00", freeBays: 3, freeTechnicians: 3 },
  ],
  unavailableReason: null,
}
