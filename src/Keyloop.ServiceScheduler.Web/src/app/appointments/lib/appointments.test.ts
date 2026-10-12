import { describe, expect, it } from "vitest"

import { appointments, bays, readingSunday, readingTuesday, technicians, withStatus } from "@/test/schedules"

import {
  appointmentRows,
  appointmentStats,
  durationMinutes,
  filterOptions,
  matchesFacet,
  matchesSearch,
} from "./appointments"

const rows = appointmentRows(readingTuesday)
const row = (id: string) => rows.find((candidate) => candidate.id === id)!

describe("appointmentRows", () => {
  it("flattens the schedule's bays into one list by start time, each appointment knowing its bay", () => {
    expect(rows.map((candidate) => [candidate.startLocal.slice(11, 16), candidate.serviceType.name, candidate.bay.name])).toEqual([
      ["08:00", "Interim Service", "Bay 1 - Standard"],
      ["09:00", "EV Battery Health Check", "Bay 4 - EV"],
      ["10:30", "Brake Pads & Discs", "Bay 1 - Standard"],
      ["11:00", "MOT Test", "Bay 6 - MOT"],
      ["13:00", "Full Service", "Bay 1 - Standard"],
      ["15:00", "Four-Wheel Alignment", "Bay 2 - Alignment"],
    ])
    expect(row(appointments.evBattery.id).bay).toEqual(bays.ev)
  })

  it("keeps the API's bay order for appointments that start together", () => {
    const together = {
      ...readingTuesday,
      bays: readingTuesday.bays.map((bay) =>
        bay.id === bays.mot.id ? { ...bay, appointments: [{ ...appointments.mot, startUtc: appointments.interim.startUtc }] } : bay
      ),
    }

    expect(appointmentRows(together).slice(0, 2).map((candidate) => candidate.bay.name)).toEqual(["Bay 1 - Standard", "Bay 6 - MOT"])
  })

  it("has nothing to list on a closed day", () => {
    expect(appointmentRows(readingSunday)).toEqual([])
  })
})

describe("durationMinutes", () => {
  it("is the booked time from start to end", () => {
    expect(durationMinutes(row(appointments.brakes.id))).toBe(90)
    expect(durationMinutes(row(appointments.mot.id))).toBe(45)
  })
})

describe("matchesSearch", () => {
  it("finds a customer by any part of the name, ignoring case", () => {
    expect(matchesSearch(row(appointments.full.id), "olivia")).toBe(true)
    expect(matchesSearch(row(appointments.full.id), "BENNETT")).toBe(true)
    expect(matchesSearch(row(appointments.interim.id), "olivia")).toBe(false)
  })

  it("finds a registration however it is spaced", () => {
    expect(matchesSearch(row(appointments.full.id), "re21klm")).toBe(true)
    expect(matchesSearch(row(appointments.full.id), "RE21 KLM")).toBe(true)
    expect(matchesSearch(row(appointments.full.id), "re 21")).toBe(true)
  })

  it("finds a VIN by any part of it", () => {
    expect(matchesSearch(row(appointments.evBattery.id), "wf0xxx")).toBe(true)
    expect(matchesSearch(row(appointments.evBattery.id), "DA12346")).toBe(true)
  })

  it("does not search the service, bay or technician (the faceted filters do)", () => {
    expect(matchesSearch(row(appointments.interim.id), "Interim")).toBe(false)
    expect(matchesSearch(row(appointments.interim.id), "Bay 1")).toBe(false)
    expect(matchesSearch(row(appointments.interim.id), "Amelia")).toBe(false)
  })

  it("lets every appointment through an empty or blank search", () => {
    expect(rows.every((candidate) => matchesSearch(candidate, ""))).toBe(true)
    expect(rows.every((candidate) => matchesSearch(candidate, "   "))).toBe(true)
  })
})

describe("matchesFacet", () => {
  it("lets everything through when nothing is chosen", () => {
    expect(matchesFacet("Confirmed", undefined)).toBe(true)
    expect(matchesFacet("Confirmed", [])).toBe(true)
  })

  it("keeps only the chosen values", () => {
    expect(matchesFacet("Completed", ["Completed", "NoShow"])).toBe(true)
    expect(matchesFacet("Confirmed", ["Completed", "NoShow"])).toBe(false)
  })
})

describe("filterOptions", () => {
  it("offers the five board statuses in lifecycle order", () => {
    expect(filterOptions(readingTuesday).status).toEqual([
      { value: "Confirmed", label: "Confirmed" },
      { value: "CheckedIn", label: "Checked in" },
      { value: "InProgress", label: "In progress" },
      { value: "Completed", label: "Completed" },
      { value: "NoShow", label: "No-show" },
    ])
  })

  it("offers every bay and technician of the dealership in the API's order, with nothing booked or not", () => {
    const options = filterOptions(readingTuesday)
    expect(options.bay.map((option) => option.label)).toEqual([
      "Bay 1 - Standard",
      "Bay 2 - Alignment",
      "Bay 3 - Heavy duty",
      "Bay 4 - EV",
      "Bay 5 - Diagnostics",
      "Bay 6 - MOT",
    ])
    expect(options.bay[0]).toEqual({ value: bays.standard.id, label: bays.standard.name })
    expect(options.technician.map((option) => option.label)).toEqual([
      "Amelia Clarke",
      "Ben Okafor",
      "Chloe Nguyen",
      "Daniel Moss",
      "Eva Lindqvist",
      "Farid Haddad",
    ])
    expect(options.technician[0].value).toBe(technicians.amelia.id)
  })

  it("offers the services of the day by name, and the whole catalogue once it is known", () => {
    expect(filterOptions(readingTuesday).service.map((option) => option.label)).toEqual([
      "Brake Pads & Discs",
      "EV Battery Health Check",
      "Four-Wheel Alignment",
      "Full Service",
      "Interim Service",
      "MOT Test",
    ])

    const diagnostics = { id: "8d1c3a9e-0000-4000-8000-000000000001", code: "DIAGNOSTICS", name: "Diagnostics Check", durationMinutes: 60 }
    const withCatalogue = filterOptions(readingSunday, [diagnostics, appointments.interim.serviceType])
    expect(withCatalogue.service).toEqual([
      { value: diagnostics.id, label: "Diagnostics Check" },
      { value: appointments.interim.serviceType.id, label: "Interim Service" },
    ])
  })
})

describe("appointmentStats", () => {
  it("counts the day's appointments, the active ones, the completed ones and the no-shows", () => {
    // Every figure differs (6, 3, 2, 1), so each is pinned to its own statuses.
    let schedule = withStatus(readingTuesday, appointments.interim.id, "Completed")
    schedule = withStatus(schedule, appointments.full.id, "Completed")
    schedule = withStatus(schedule, appointments.evBattery.id, "NoShow")
    schedule = withStatus(schedule, appointments.brakes.id, "InProgress")
    schedule = withStatus(schedule, appointments.mot.id, "CheckedIn")

    expect(appointmentStats(appointmentRows(schedule))).toEqual({ total: 6, active: 3, completed: 2, noShows: 1 })
  })

  it("is all zeros for an empty day", () => {
    expect(appointmentStats([])).toEqual({ total: 0, active: 0, completed: 0, noShows: 0 })
  })
})
