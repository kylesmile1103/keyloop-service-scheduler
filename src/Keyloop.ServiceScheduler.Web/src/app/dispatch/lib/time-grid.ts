import type { OperatingWindowResponse } from "@/api/types.gen"
import { formatLocalTime } from "@/lib/local-time"

/**
 * The timeline's geometry. The board is a CSS grid whose time columns are slots of `granularityMinutes` (15 by default,
 * the API's booking grid) laid over a span of UTC instants. Grid *lines* are numbered from 1 at the span's start to
 * `columns + 1` at its end, as CSS numbers them; the lane column in front of them is the page's business, not this module's.
 * Everything is computed from UTC instants, so a day on which the clocks change simply has more or fewer columns.
 */
export interface GridSpec {
  startUtc: Date
  endUtc: Date
  granularityMinutes: number
  columns: number
}

const minute = 60_000

export function buildGrid(window: { startUtc: string; endUtc: string }, granularityMinutes: number): GridSpec {
  if (!Number.isInteger(granularityMinutes) || granularityMinutes <= 0) {
    throw new RangeError(`The slot granularity must be a positive whole number of minutes, not ${granularityMinutes}.`)
  }
  const startUtc = new Date(window.startUtc)
  const endUtc = new Date(window.endUtc)
  const columns = Math.max(0, Math.ceil((endUtc.getTime() - startUtc.getTime()) / (granularityMinutes * minute)))
  return { startUtc, endUtc, granularityMinutes, columns }
}

/** Slots between the grid's start and an instant, as a fraction (2.5 = halfway through the third slot). */
function slotsFromStart(instantUtc: string | Date, grid: GridSpec): number {
  return (new Date(instantUtc).getTime() - grid.startUtc.getTime()) / (grid.granularityMinutes * minute)
}

const clampLine = (line: number, grid: GridSpec) => Math.min(Math.max(line, 1), grid.columns + 1)

/** The grid line at or before an instant: 1 at the start, `columns + 1` at the end; instants outside the span are clamped. */
export function columnFor(instantUtc: string, grid: GridSpec): number {
  return clampLine(Math.floor(slotsFromStart(instantUtc, grid)) + 1, grid)
}

/**
 * The grid lines an appointment spans (`grid-column: start / end`). A start between two lines rounds down and an end rounds
 * up, so the block always covers its whole time; inside the span it is at least one column wide. An appointment entirely
 * outside the span gets `start === end`.
 */
export function spanFor(startUtc: string, endUtc: string, grid: GridSpec): { start: number; end: number } {
  const start = columnFor(startUtc, grid)
  const overlaps = Date.parse(endUtc) > grid.startUtc.getTime() && Date.parse(startUtc) < grid.endUtc.getTime()
  if (!overlaps) return { start, end: start }
  const end = clampLine(Math.ceil(slotsFromStart(endUtc, grid)) + 1, grid)
  return { start, end: Math.max(end, start + 1) }
}

/** Minutes past the hour in an API local string (`2026-10-13T07:30+02:00` → 30). */
function minutesPastHour(local: string): number {
  const match = /T\d{2}:(\d{2})/.exec(local)
  if (!match) throw new RangeError(`Expected a local time like 2026-10-13T07:30+02:00, got "${local}".`)
  return Number(match[1])
}

/**
 * The span the board draws for a day: the operating window widened to whole local hours, so the ruler starts and ends on an
 * hour (München's 07:30–18:30 is drawn 07:00–19:00, with the half hours either side shaded as closed). The window is kept
 * as it is when widening would leave the slot grid (a granularity that does not divide the extra minutes).
 */
export function boardWindow(window: OperatingWindowResponse, granularityMinutes: number): { startUtc: string; endUtc: string } {
  const before = minutesPastHour(window.opensAtLocal)
  const closingPast = minutesPastHour(window.closesAtLocal)
  const after = closingPast === 0 ? 0 : 60 - closingPast
  if (before % granularityMinutes !== 0 || after % granularityMinutes !== 0) {
    return { startUtc: window.startUtc, endUtc: window.endUtc }
  }
  const iso = (time: number) => new Date(time).toISOString().replace(".000Z", "Z")
  return {
    startUtc: iso(new Date(window.startUtc).getTime() - before * minute),
    endUtc: iso(new Date(window.endUtc).getTime() + after * minute),
  }
}

/** The grid lines that fall on a whole hour of the dealership's local time, with that hour as a label. */
export function hourLines(grid: GridSpec, timeZone: string): Array<{ column: number; label: string }> {
  const lines: Array<{ column: number; label: string }> = []
  for (let line = 1; line <= grid.columns; line++) {
    const instant = new Date(grid.startUtc.getTime() + (line - 1) * grid.granularityMinutes * minute).toISOString()
    const label = formatLocalTime(instant, timeZone)
    if (label.endsWith(":00")) lines.push({ column: line, label })
  }
  return lines
}

/** Where "now" sits across the grid, from 0 (its start) towards 1 (its end); `null` when now is outside it. */
export function nowPosition(grid: GridSpec, now: Date): number | null {
  const span = grid.endUtc.getTime() - grid.startUtc.getTime()
  const elapsed = now.getTime() - grid.startUtc.getTime()
  return span > 0 && elapsed >= 0 && elapsed < span ? elapsed / span : null
}

/**
 * Rows for one lane's appointments so that none hides another. Active appointments never overlap on a bay or a technician
 * (the database's exclusion constraints), but completed and no-show ones no longer hold their resources, so a later booking
 * may overlap them. Each appointment goes on the first row that is free at its start (intervals are half-open).
 */
export function stackRows<T extends { startUtc: string; endUtc: string }>(items: readonly T[]): {
  rows: number
  placed: Array<{ item: T; row: number }>
} {
  const sorted = [...items].sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc) || Date.parse(a.endUtc) - Date.parse(b.endUtc))
  const rowEnds: number[] = []
  const placed = sorted.map((item) => {
    const start = Date.parse(item.startUtc)
    let row = rowEnds.findIndex((end) => end <= start)
    if (row === -1) row = rowEnds.push(0) - 1
    rowEnds[row] = Date.parse(item.endUtc)
    return { item, row }
  })
  return { rows: Math.max(rowEnds.length, 1), placed }
}
