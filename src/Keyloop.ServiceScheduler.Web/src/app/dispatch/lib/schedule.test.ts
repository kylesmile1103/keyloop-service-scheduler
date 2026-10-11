import { describe, expect, it } from "vitest"

import { appointments, bays, readingSunday, readingTuesday, technicians, withStatus } from "@/test/schedules"

import { buildLanes, scheduleKpis } from "./schedule"

describe("buildLanes", () => {
  it("makes one lane per bay, in the API's order, each with its appointments by start and the bay named on each", () => {
    const lanes = buildLanes(readingTuesday, "bays")

    expect(lanes.map((lane) => lane.name)).toEqual([
      "Bay 1 - Standard",
      "Bay 2 - Alignment",
      "Bay 3 - Heavy duty",
      "Bay 4 - EV",
      "Bay 5 - Diagnostics",
      "Bay 6 - MOT",
    ])
    expect(lanes[0]).toMatchObject({ id: bays.standard.id, kind: "bays", isActive: true, capabilities: ["StandardLift"] })
    expect(lanes[0].appointments.map((appointment) => appointment.id)).toEqual([
      appointments.interim.id,
      appointments.brakes.id,
      appointments.full.id,
    ])
    expect(lanes[0].appointments[0].bay).toEqual(bays.standard)
  })

  it("makes one lane per technician, gathering each one's appointments from every bay", () => {
    const lanes = buildLanes(readingTuesday, "technicians")

    expect(lanes.map((lane) => lane.name)).toEqual([
      "Amelia Clarke",
      "Ben Okafor",
      "Chloe Nguyen",
      "Daniel Moss",
      "Eva Lindqvist",
      "Farid Haddad",
    ])
    const chloe = lanes.find((lane) => lane.id === technicians.chloe.id)!
    expect(chloe).toMatchObject({ kind: "technicians", detail: "T-1003", certifications: ["GeneralService", "Brakes", "WheelAlignment"] })
    // Bay 1 at 10:30 and Bay 2 at 15:00, in start order, each still naming its bay.
    expect(chloe.appointments.map((appointment) => [appointment.id, appointment.bay.name])).toEqual([
      [appointments.brakes.id, "Bay 1 - Standard"],
      [appointments.alignment.id, "Bay 2 - Alignment"],
    ])
    expect(lanes.find((lane) => lane.id === technicians.eva.id)!.appointments).toEqual([])
  })

  it("keeps inactive resources as lanes and says so", () => {
    const schedule = {
      ...readingTuesday,
      bays: readingTuesday.bays.map((bay) => (bay.id === bays.heavy.id ? { ...bay, isActive: false } : bay)),
    }

    expect(buildLanes(schedule, "bays").find((lane) => lane.id === bays.heavy.id)!.isActive).toBe(false)
  })
})

describe("scheduleKpis", () => {
  // 09:30 in Reading: the EV battery check (09:00–10:00, Ben Okafor) is the only job under way.
  const midMorning = new Date("2026-10-13T08:30:00Z")

  it("counts the day's appointments", () => {
    expect(scheduleKpis(readingTuesday, midMorning).appointments).toBe(6)
  })

  it("measures bay utilisation as booked minutes over the active bays' opening minutes", () => {
    // 60 + 90 + 120 + 45 + 60 + 45 = 420 booked minutes of 6 bays × 600 minutes.
    expect(scheduleKpis(readingTuesday, midMorning).utilisation).toEqual({ bookedMinutes: 420, capacityMinutes: 3600 })
  })

  it("leaves no-shows and inactive bays out of utilisation", () => {
    const schedule = withStatus(
      {
        ...readingTuesday,
        bays: readingTuesday.bays.map((bay) => (bay.id === bays.heavy.id ? { ...bay, isActive: false } : bay)),
      },
      appointments.mot.id,
      "NoShow"
    )

    expect(scheduleKpis(schedule, midMorning).utilisation).toEqual({ bookedMinutes: 375, capacityMinutes: 3000 })
  })

  it("counts the active technicians working at this moment", () => {
    expect(scheduleKpis(readingTuesday, midMorning).busyNow).toEqual({ busy: 1, active: 6 })
    // A finished or missed job does not keep a technician busy.
    expect(scheduleKpis(withStatus(readingTuesday, appointments.evBattery.id, "Completed"), midMorning).busyNow).toEqual({
      busy: 0,
      active: 6,
    })
  })

  it("has no 'busy now' figure for a day other than today", () => {
    expect(scheduleKpis(readingTuesday, new Date("2026-10-14T08:30:00Z")).busyNow).toBeNull()
    expect(scheduleKpis(readingTuesday, new Date("2026-10-13T06:00:00Z")).busyNow).toEqual({ busy: 0, active: 6 })
  })

  it("has no utilisation on a closed day", () => {
    expect(scheduleKpis(readingSunday, midMorning)).toEqual({ appointments: 0, utilisation: null, busyNow: null })
  })
})
