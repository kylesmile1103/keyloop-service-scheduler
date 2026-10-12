import { describe, expect, it } from "vitest"

import {
  boardWindow,
  buildGrid,
  columnFor,
  formatLocalTime,
  hourLines,
  nowPosition,
  spanFor,
  stackRows,
} from "./time-grid"

// Reading on Tuesday 2026-10-13: 08:00–18:00 BST is 07:00–17:00Z.
const tenHours = { startUtc: "2026-10-13T07:00:00Z", endUtc: "2026-10-13T17:00:00Z" }

describe("the brief's grid functions", () => {
  it("buildGrid_for_10h_window_at_15m_has_40_columns", () => {
    const grid = buildGrid(tenHours, 15)

    expect(grid).toEqual({
      startUtc: new Date("2026-10-13T07:00:00Z"),
      endUtc: new Date("2026-10-13T17:00:00Z"),
      granularityMinutes: 15,
      columns: 40,
    })
  })

  it("columnFor_start_is_1", () => {
    expect(columnFor(tenHours.startUtc, buildGrid(tenHours, 15))).toBe(1)
  })

  it("spanFor_09_00_10_00_in_08_00_window_is_5_to_9", () => {
    // 09:00–10:00 local is 08:00–09:00Z, one hour into the 07:00Z window: grid lines 5 and 9.
    expect(spanFor("2026-10-13T08:00:00Z", "2026-10-13T09:00:00Z", buildGrid(tenHours, 15))).toEqual({ start: 5, end: 9 })
  })

  it("clamps_instants_outside_window", () => {
    const grid = buildGrid(tenHours, 15)

    expect(columnFor("2026-10-13T05:00:00Z", grid)).toBe(1)
    expect(columnFor("2026-10-13T19:00:00Z", grid)).toBe(41)
    // A block that starts before opening and ends after closing covers the whole window.
    expect(spanFor("2026-10-13T06:00:00Z", "2026-10-13T18:00:00Z", grid)).toEqual({ start: 1, end: 41 })
  })

  it("formatLocalTime_uses_zone", () => {
    expect(formatLocalTime("2026-10-13T09:00:00Z", "Europe/London")).toBe("10:00")
    expect(formatLocalTime("2026-10-13T09:00:00Z", "Europe/Berlin")).toBe("11:00")
  })

  it("fall_back_day_window_has_44_columns", () => {
    // London on Sunday 2026-10-25, the day the clocks go back: 00:00–10:00 local runs from 23:00Z the day before to 10:00Z,
    // eleven real hours.
    const grid = buildGrid({ startUtc: "2026-10-24T23:00:00Z", endUtc: "2026-10-25T10:00:00Z" }, 15)

    expect(grid.columns).toBe(44)
  })
})

describe("grid placement details", () => {
  const grid = buildGrid(tenHours, 15)

  it("rounds a start between grid lines down and an end up, so a block always covers its own time", () => {
    expect(spanFor("2026-10-13T07:20:00Z", "2026-10-13T07:50:00Z", grid)).toEqual({ start: 2, end: 5 })
  })

  it("gives an appointment inside the window at least one column", () => {
    expect(spanFor("2026-10-13T07:00:00Z", "2026-10-13T07:05:00Z", grid)).toEqual({ start: 1, end: 2 })
  })

  it("gives an appointment entirely outside the window no columns", () => {
    expect(spanFor("2026-10-13T05:00:00Z", "2026-10-13T06:00:00Z", grid)).toEqual({ start: 1, end: 1 })
    expect(spanFor("2026-10-13T17:00:00Z", "2026-10-13T18:00:00Z", grid)).toEqual({ start: 41, end: 41 })
  })

  it("has no columns for an empty window (opening hours lost in a daylight-saving gap)", () => {
    expect(buildGrid({ startUtc: "2026-03-29T01:00:00Z", endUtc: "2026-03-29T01:00:00Z" }, 15).columns).toBe(0)
  })

  it("rejects a granularity that is not a positive whole number of minutes", () => {
    expect(() => buildGrid(tenHours, 0)).toThrow(RangeError)
    expect(() => buildGrid(tenHours, 7.5)).toThrow(RangeError)
  })
})

describe("boardWindow", () => {
  it("keeps a window that opens and closes on the hour", () => {
    expect(
      boardWindow(
        { ...tenHours, opensAtLocal: "2026-10-13T08:00+01:00", closesAtLocal: "2026-10-13T18:00+01:00" },
        15
      )
    ).toEqual(tenHours)
  })

  it("widens a half-hour opening to whole local hours, so the ruler starts and ends on an hour", () => {
    // München: 07:30–18:30 CEST is 05:30–16:30Z; the board draws 07:00–19:00 local.
    expect(
      boardWindow(
        {
          startUtc: "2026-10-13T05:30:00Z",
          endUtc: "2026-10-13T16:30:00Z",
          opensAtLocal: "2026-10-13T07:30+02:00",
          closesAtLocal: "2026-10-13T18:30+02:00",
        },
        15
      )
    ).toEqual({ startUtc: "2026-10-13T05:00:00Z", endUtc: "2026-10-13T17:00:00Z" })
  })

  it("keeps the exact window when the widening would not fall on the slot grid", () => {
    const window = {
      startUtc: "2026-10-13T05:30:00Z",
      endUtc: "2026-10-13T16:30:00Z",
      opensAtLocal: "2026-10-13T07:30+02:00",
      closesAtLocal: "2026-10-13T18:30+02:00",
    }

    expect(boardWindow(window, 20)).toEqual({ startUtc: window.startUtc, endUtc: window.endUtc })
  })
})

describe("hourLines", () => {
  it("labels the grid lines that fall on a whole local hour", () => {
    const lines = hourLines(buildGrid(tenHours, 15), "Europe/London")

    expect(lines.map((line) => line.label)).toEqual([
      "08:00",
      "09:00",
      "10:00",
      "11:00",
      "12:00",
      "13:00",
      "14:00",
      "15:00",
      "16:00",
      "17:00",
    ])
    expect(lines.map((line) => line.column)).toEqual([1, 5, 9, 13, 17, 21, 25, 29, 33, 37])
  })

  it("follows the dealership's zone, not the browser's", () => {
    const lines = hourLines(buildGrid({ startUtc: "2026-10-13T05:00:00Z", endUtc: "2026-10-13T07:00:00Z" }, 15), "Europe/Berlin")

    expect(lines).toEqual([
      { column: 1, label: "07:00" },
      { column: 5, label: "08:00" },
    ])
  })

  it("labels the repeated hour twice on the day the clocks go back", () => {
    // London 2026-10-25: 01:00 BST (00:00Z) and 01:00 GMT (01:00Z) are both on the ruler.
    const lines = hourLines(buildGrid({ startUtc: "2026-10-24T23:00:00Z", endUtc: "2026-10-25T02:00:00Z" }, 15), "Europe/London")

    expect(lines.map((line) => line.label)).toEqual(["00:00", "01:00", "01:00"])
  })
})

describe("nowPosition", () => {
  const grid = buildGrid(tenHours, 15)

  it("is the fraction of the window that has passed", () => {
    expect(nowPosition(grid, new Date("2026-10-13T09:30:00Z"))).toBe(0.25)
    expect(nowPosition(grid, new Date("2026-10-13T07:00:00Z"))).toBe(0)
  })

  it("is null outside the window: before opening, at or after closing, or another day", () => {
    expect(nowPosition(grid, new Date("2026-10-13T06:59:00Z"))).toBeNull()
    expect(nowPosition(grid, new Date("2026-10-13T17:00:00Z"))).toBeNull()
    expect(nowPosition(grid, new Date("2026-10-14T09:30:00Z"))).toBeNull()
  })
})

describe("stackRows", () => {
  const at = (start: string, end: string, id: string) => ({ id, startUtc: `2026-10-13T${start}:00Z`, endUtc: `2026-10-13T${end}:00Z` })

  it("keeps back-to-back appointments on one row (intervals are half-open)", () => {
    const { rows, placed } = stackRows([at("07:00", "08:00", "a"), at("08:00", "09:00", "b")])

    expect(rows).toBe(1)
    expect(placed.map(({ item, row }) => [item.id, row])).toEqual([
      ["a", 0],
      ["b", 0],
    ])
  })

  it("moves an overlapping appointment to the next free row, in start order", () => {
    // A completed or no-show appointment no longer holds its bay, so a later booking may overlap it on the board.
    const { rows, placed } = stackRows([at("09:00", "10:00", "c"), at("07:00", "09:30", "a"), at("08:00", "08:30", "b")])

    expect(rows).toBe(2)
    expect(placed.map(({ item, row }) => [item.id, row])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 1],
    ])
  })

  it("has one row even when the lane is empty", () => {
    expect(stackRows([])).toEqual({ rows: 1, placed: [] })
  })
})
