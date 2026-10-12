import { Ban, CalendarCheck, CircleCheck, KeyRound, UserX, Wrench } from "lucide-react"
import { describe, expect, it } from "vitest"

import type { AppointmentStatus } from "@/api/types.gen"

import { boardStatuses, canCancel, statusMeta } from "./status"

const every: AppointmentStatus[] = ["Confirmed", "CheckedIn", "InProgress", "Completed", "Cancelled", "NoShow"]

describe("appointment status presentation", () => {
  it("names every status in plain words", () => {
    expect(every.map((status) => statusMeta[status].label)).toEqual([
      "Confirmed",
      "Checked in",
      "In progress",
      "Completed",
      "Cancelled",
      "No-show",
    ])
  })

  it("gives every status its own icon, so colour is never the only signal", () => {
    expect(new Set(every.map((status) => statusMeta[status].icon)).size).toBe(every.length)
  })

  it("uses the design system's icons (UI_DESIGN 4.3): keys handed over for a check-in", () => {
    expect(every.map((status) => statusMeta[status].icon)).toEqual([CalendarCheck, KeyRound, Wrench, CircleCheck, Ban, UserX])
  })

  it("styles every status with its own tokens (src/index.css --status-*)", () => {
    expect(statusMeta.CheckedIn.tone).toBe("checked-in")
    for (const status of every) {
      const { tone, classes } = statusMeta[status]
      expect(classes.block).toContain(`bg-status-${tone}-bg`)
      expect(classes.block).toContain(`border-status-${tone}-border`)
      expect(classes.block).toContain(`text-status-${tone}-fg`)
      expect(classes.dot).toContain(`bg-status-${tone}-border`)
      expect(classes.bar).toContain(`border-status-${tone}-border`)
      // The status icon tile (UI_DESIGN 11.10): the tint and the ink, on the 8 px chip radius.
      expect(classes.tile).toContain(`bg-status-${tone}-bg`)
      expect(classes.tile).toContain(`text-status-${tone}-fg`)
      expect(classes.tile).toContain("rounded-chip")
    }
  })

  it("lists the statuses a board can show, in lifecycle order (cancelled ones are not on the board)", () => {
    expect(boardStatuses).toEqual(["Confirmed", "CheckedIn", "InProgress", "Completed", "NoShow"])
  })

  it("allows cancelling only a confirmed or checked-in appointment (ARCHITECTURE §5.5)", () => {
    expect(every.filter(canCancel)).toEqual(["Confirmed", "CheckedIn"])
  })
})
