import { describe, expect, it } from "vitest"

import type { WorkshopScheduleResponse } from "@/api/types.gen"
import { munichCatalogue, readingCatalogue } from "@/test/catalogue"
import { appointments, bays, munichTuesday, readingSunday, readingTuesday, technicians, withStatus } from "@/test/schedules"

import {
  bayFigures,
  bayRecords,
  formatMinutes,
  matchesSearch,
  serviceFigures,
  serviceRecords,
  technicianFigures,
  technicianRecords,
} from "./resources"

const technician = (schedule: WorkshopScheduleResponse, id: string) => technicianRecords(schedule).find((record) => record.id === id)!
const bay = (schedule: WorkshopScheduleResponse, id: string) => bayRecords(schedule).find((record) => record.id === id)!

/** Reading's Tuesday with one bay and one technician out of service. */
function withInactive(schedule: WorkshopScheduleResponse): WorkshopScheduleResponse {
  return {
    ...schedule,
    bays: schedule.bays.map((entry) => (entry.id === bays.mot.id ? { ...entry, isActive: false } : entry)),
    technicians: schedule.technicians.map((entry) => (entry.id === technicians.eva.id ? { ...entry, isActive: false } : entry)),
  }
}

describe("technicianRecords", () => {
  it("lists the roster in the API's order, each with today's appointments and booked minutes from every bay", () => {
    const records = technicianRecords(readingTuesday)

    expect(records.map((record) => [record.name, record.employeeNumber, record.today.appointments, record.today.bookedMinutes])).toEqual([
      ["Amelia Clarke", "T-1001", 1, 60],
      ["Ben Okafor", "T-1002", 1, 60],
      // Brake pads in Bay 1 and the alignment in Bay 2.
      ["Chloe Nguyen", "T-1003", 2, 135],
      ["Daniel Moss", "T-1004", 1, 120],
      ["Eva Lindqvist", "T-1005", 0, 0],
      ["Farid Haddad", "T-1006", 1, 45],
    ])
    expect(records[0]).toMatchObject({ certifications: ["GeneralService", "Brakes", "MotTester"], isActive: true })
    expect(records.every((record) => record.today.windowMinutes === 600)).toBe(true)
  })

  it("counts a no-show as an appointment but not as booked time, as the board's utilisation does", () => {
    const record = technician(withStatus(readingTuesday, appointments.full.id, "NoShow"), technicians.daniel.id)

    expect(record.today).toMatchObject({ appointments: 1, bookedMinutes: 0 })
  })

  it("counts only the part of an appointment inside the opening hours", () => {
    const early = {
      ...readingTuesday,
      bays: readingTuesday.bays.map((entry) =>
        entry.id === bays.heavy.id
          ? { ...entry, appointments: [{ ...appointments.interim, id: "early", startUtc: "2026-10-13T06:30:00Z", technician: technicians.eva }] }
          : entry
      ),
    }

    // 06:30-08:00 UTC against a window opening at 07:00 UTC: the first half hour is outside it.
    expect(technician(early, technicians.eva.id).today.bookedMinutes).toBe(90 - 30)
  })

  it("has no opening window on a closed day", () => {
    expect(technician(readingSunday, technicians.amelia.id).today).toEqual({ appointments: 0, bookedMinutes: 0, windowMinutes: null })
  })
})

describe("bayRecords", () => {
  it("lists every bay with its equipment and today's appointments and booked minutes, without the appointments themselves", () => {
    const records = bayRecords(readingTuesday)

    expect(records.map((record) => [record.name, record.today.appointments, record.today.bookedMinutes])).toEqual([
      ["Bay 1 - Standard", 3, 270],
      ["Bay 2 - Alignment", 1, 45],
      ["Bay 3 - Heavy duty", 0, 0],
      ["Bay 4 - EV", 1, 60],
      ["Bay 5 - Diagnostics", 0, 0],
      ["Bay 6 - MOT", 1, 45],
    ])
    expect(records[4]).toEqual({
      id: bays.diagnostics.id,
      name: "Bay 5 - Diagnostics",
      capabilities: ["StandardLift", "Diagnostics", "AirConditioning"],
      isActive: true,
      today: { appointments: 0, bookedMinutes: 0, windowMinutes: 600 },
    })
  })

  it("keeps an out-of-service bay with the work it still holds", () => {
    expect(bay(withInactive(readingTuesday), bays.mot.id)).toMatchObject({ isActive: false, today: { appointments: 1, bookedMinutes: 45 } })
  })
})

describe("serviceRecords", () => {
  it("lists the catalogue with how many of today's appointments are for each service", () => {
    const records = serviceRecords(readingCatalogue, readingTuesday)

    expect(records.map((record) => [record.code, record.bookedToday])).toEqual([
      ["AIRCON-REGAS", 0],
      ["BRAKES-PADS-DISCS", 1],
      ["DIAG-FAULT-FINDING", 0],
      ["EV-BATTERY-CHECK", 1],
      ["EV-CHARGING-FAULT", 0],
      ["WHEEL-ALIGNMENT", 1],
      ["FULL-SERVICE", 1],
      ["HEAVY-VAN-SERVICE", 0],
      ["INTERIM-SERVICE", 1],
      ["MOT-TEST", 1],
    ])
    expect(records.every((record) => record.bookable && record.shortfall === null)).toBe(true)
  })

  it("says what an unbookable service needs that no active bay or technician has", () => {
    const records = serviceRecords(munichCatalogue, munichTuesday)
    const shortfall = (code: string) => records.find((record) => record.code === code)!.shortfall

    expect(shortfall("INTERIM-SERVICE")).toBeNull()
    expect(shortfall("MOT-TEST")).toEqual({ capabilities: ["MotTesting"], certifications: ["MotTester"] })
    expect(shortfall("DIAG-FAULT-FINDING")).toEqual({ capabilities: ["Diagnostics"], certifications: [] })
    // Hans holds high-voltage electrical and Ingrid diagnostics, but nobody holds both: each need exists, the pair does not.
    expect(shortfall("EV-CHARGING-FAULT")).toEqual({ capabilities: [], certifications: [] })
  })

  it("counts an inactive bay or technician as missing", () => {
    const shortfall = serviceRecords(
      readingCatalogue.map((service) => (service.code === "MOT-TEST" ? { ...service, bookable: false } : service)),
      withInactive(readingTuesday)
    ).find((record) => record.code === "MOT-TEST")!.shortfall

    // Bay 6 is the only MOT bay; Amelia and Farid are still MOT testers.
    expect(shortfall).toEqual({ capabilities: ["MotTesting"], certifications: [] })
  })
})

describe("figures", () => {
  it("sums the technicians: the roster, those working today, booked time and their share of the opening hours", () => {
    expect(technicianFigures(technicianRecords(readingTuesday))).toEqual({
      total: 6,
      active: 6,
      working: 5,
      appointments: 6,
      bookedMinutes: 420,
      capacityMinutes: 3600,
    })
    // Eva, inactive, had nothing today: she leaves the active roster and its capacity.
    expect(technicianFigures(technicianRecords(withInactive(readingTuesday)))).toMatchObject({ total: 6, active: 5, capacityMinutes: 3000 })
  })

  it("sums the bays as the board's bay utilisation does: active bays only", () => {
    expect(bayFigures(bayRecords(readingTuesday))).toEqual({
      total: 6,
      inService: 6,
      inUse: 4,
      appointments: 6,
      bookedMinutes: 420,
      capacityMinutes: 3600,
    })
    expect(bayFigures(bayRecords(withInactive(readingTuesday)))).toEqual({
      total: 6,
      inService: 5,
      inUse: 3,
      appointments: 6,
      bookedMinutes: 375,
      capacityMinutes: 3000,
    })
  })

  it("has no capacity on a closed day", () => {
    expect(bayFigures(bayRecords(readingSunday)).capacityMinutes).toBeNull()
    expect(technicianFigures(technicianRecords(readingSunday)).capacityMinutes).toBeNull()
  })

  it("sums the catalogue: bookable here, booked today and the range of durations", () => {
    expect(serviceFigures(serviceRecords(munichCatalogue, munichTuesday))).toEqual({
      total: 10,
      bookable: 5,
      bookedToday: 0,
      servicesBookedToday: 0,
      shortestMinutes: 45,
      longestMinutes: 180,
    })
    expect(serviceFigures(serviceRecords(readingCatalogue, readingTuesday))).toMatchObject({ bookedToday: 6, servicesBookedToday: 6 })
    expect(serviceFigures([])).toMatchObject({ total: 0, shortestMinutes: null, longestMinutes: null })
  })
})

describe("formatMinutes", () => {
  it.each([
    [0, "0 min"],
    [45, "45 min"],
    [60, "1 h"],
    [135, "2 h 15 min"],
    [600, "10 h"],
  ])("writes %i minutes as %s", (minutes, text) => {
    expect(formatMinutes(minutes)).toBe(text)
  })
})

describe("matchesSearch", () => {
  it("finds any of the fields by any part, ignoring case and spaces", () => {
    expect(matchesSearch(["Amelia Clarke", "T-1001"], "clarke")).toBe(true)
    expect(matchesSearch(["Amelia Clarke", "T-1001"], "t-10 01")).toBe(true)
    expect(matchesSearch(["Amelia Clarke", "T-1001"], "ben")).toBe(false)
    expect(matchesSearch(["Amelia Clarke", "T-1001"], "  ")).toBe(true)
  })
})
