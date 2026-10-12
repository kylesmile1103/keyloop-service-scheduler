import type { CSSProperties } from "react"

import type { OperatingWindowResponse } from "@/api/types.gen"
import { CapabilityBadges } from "@/components/capability-badges"
import { cn } from "@/lib/utils"

import type { BoardAppointment, Lane, LaneMode } from "../lib/schedule"
import { boardWindow, buildGrid, formatLocalTime, type GridSpec, hourLines, nowPosition, spanFor, stackRows } from "../lib/time-grid"
import { AppointmentBlock } from "./appointment-block"

interface TimelineGridProps {
  lanes: readonly Lane[]
  mode: LaneMode
  operatingWindow: OperatingWindowResponse
  granularityMinutes: number
  timeZone: string
  /** The current instant; the "now" line shows only while it falls inside the drawn day. */
  now: Date
  selectedId: string | null
  /** A booking just made: its block draws the booked halo. */
  bookedId?: string | null
  onSelect: (appointment: BoardAppointment, block: HTMLElement) => void
}

/** A grid line's offset across the time columns, as a CSS percentage. */
const offset = (line: number, grid: GridSpec) => `${Math.round(((line - 1) / grid.columns) * 10_000) / 100}%`
const width = (from: number, to: number, grid: GridSpec) => `${Math.round(((to - from) / grid.columns) * 10_000) / 100}%`

/**
 * The day as a resource timeline: one row per lane (bay or technician), one column per slot of the booking grid, drawn over
 * the operating window widened to whole local hours. A sticky ruler and a sticky lane column keep their place while the
 * timeline scrolls inside its card; hour lines, faint slot lines and alternating hour bands give the rhythm; closed time is
 * hatched; on today's board a "now" line marks the moment. Blocks are buttons in DOM order (lane, then time).
 */
export function TimelineGrid({
  lanes,
  mode,
  operatingWindow,
  granularityMinutes,
  timeZone,
  now,
  selectedId,
  bookedId = null,
  onSelect,
}: TimelineGridProps) {
  const grid = buildGrid(boardWindow(operatingWindow, granularityMinutes), granularityMinutes)
  const hours = hourLines(grid, timeZone)
  const open = spanFor(operatingWindow.startUtc, operatingWindow.endUtc, grid)
  const closedRuns = [
    { from: 1, to: open.start },
    { from: open.end, to: grid.columns + 1 },
  ].filter((run) => run.to > run.from)
  const nowAt = nowPosition(grid, now)
  const nowLeft = nowAt === null ? null : `${Math.round(nowAt * 10_000) / 100}%`
  const lastLine = grid.columns + 1
  const timeColumns: CSSProperties = { gridColumn: "2 / -1" }

  return (
    <div
      role="region"
      aria-label={mode === "bays" ? "Timeline by bay" : "Timeline by technician"}
      tabIndex={0}
      className="relative max-h-[min(70svh,52rem)] overflow-auto overscroll-x-contain outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <div
        className="grid min-w-fit [--lane-width:10rem] xl:[--lane-width:13.75rem]"
        style={{
          gridTemplateColumns: `var(--lane-width) repeat(${grid.columns}, minmax(1.125rem, 1fr))`,
          gridTemplateRows: `2.5rem repeat(${lanes.length}, auto)`,
        }}
      >
        {/* Ruler: decorative, since every block names its own times. Hour labels sit at the top, the "now" pill under them on
            the line it labels, so the two never overlap. */}
        <div aria-hidden="true" className="sticky top-0 z-20 col-span-full row-start-1 border-b bg-card" />
        <div
          aria-hidden="true"
          className="sticky top-0 left-0 z-30 col-start-1 row-start-1 flex items-start border-r border-b bg-card px-3 pt-1.5 text-xs font-medium text-muted-foreground"
        >
          {mode === "bays" ? "Bay" : "Technician"}
        </div>
        {hours.map((hour, index) => (
          <div
            key={`${hour.column}-${hour.label}`}
            data-slot="hour-label"
            aria-hidden="true"
            className="sticky top-0 z-20 row-start-1 flex items-start border-l px-1.5 pt-1.5 text-xs text-muted-foreground tabular-nums"
            style={{ gridColumn: `${hour.column + 1} / ${(hours[index + 1]?.column ?? lastLine) + 1}` }}
          >
            {hour.label}
          </div>
        ))}
        {nowLeft !== null && (
          <div aria-hidden="true" className="pointer-events-none sticky top-0 z-[21] row-start-1" style={timeColumns}>
            <span
              data-slot="now-label"
              className="absolute bottom-1 -translate-x-1/2 rounded-full bg-destructive px-1.5 text-2xs font-semibold text-destructive-foreground tabular-nums"
              style={{ left: nowLeft }}
            >
              {formatLocalTime(now.toISOString(), timeZone)}
            </span>
          </div>
        )}

        {/* The day's texture behind the lanes: hour bands and lines, faint slot lines, closed time, time already past. */}
        <div
          aria-hidden="true"
          className="pointer-events-none relative"
          style={{
            ...timeColumns,
            gridRow: "2 / -1",
            backgroundImage: "linear-gradient(to right, color-mix(in oklab, var(--color-border) 55%, transparent) 1px, transparent 1px)",
            backgroundSize: `calc(100% / ${grid.columns}) 100%`,
          }}
        >
          {hours.map((hour, index) =>
            index % 2 === 1 ? (
              <div
                key={`band-${hour.column}`}
                className="absolute inset-y-0 bg-muted/45"
                style={{ left: offset(hour.column, grid), width: width(hour.column, hours[index + 1]?.column ?? lastLine, grid) }}
              />
            ) : null
          )}
          {hours.map((hour) => (
            <div key={`line-${hour.column}`} className="absolute inset-y-0 border-l" style={{ left: offset(hour.column, grid) }} />
          ))}
          {closedRuns.map((run) => (
            <div
              key={run.from}
              data-slot="closed-time"
              className="absolute inset-y-0 bg-muted/60 bg-hatch"
              style={{ left: offset(run.from, grid), width: width(run.from, run.to, grid) }}
            />
          ))}
          {nowLeft !== null && <div className="absolute inset-y-0 left-0 bg-foreground/[0.025]" style={{ width: nowLeft }} />}
        </div>
        {/* Under the blocks (z-1) and the sticky lane column: the line shows in the free time and never crosses a block's text. */}
        {nowLeft !== null && (
          <div aria-hidden="true" className="pointer-events-none relative z-0" style={{ ...timeColumns, gridRow: "2 / -1" }}>
            <div data-slot="now-line" className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-destructive" style={{ left: nowLeft }} />
          </div>
        )}

        {lanes.map((lane, index) => (
          <TimelineLane
            key={lane.id}
            lane={lane}
            row={index + 2}
            grid={grid}
            mode={mode}
            timeZone={timeZone}
            selectedId={selectedId}
            bookedId={bookedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}

interface TimelineLaneProps {
  lane: Lane
  row: number
  grid: GridSpec
  mode: LaneMode
  timeZone: string
  selectedId: string | null
  bookedId: string | null
  onSelect: (appointment: BoardAppointment, block: HTMLElement) => void
}

const inactiveWords: Record<LaneMode, string> = { bays: "Out of service", technicians: "Inactive" }

/** One lane: its sticky label (name, equipment or certifications) and its appointments, stacked when they overlap. */
function TimelineLane({ lane, row, grid, mode, timeZone, selectedId, bookedId, onSelect }: TimelineLaneProps) {
  const { rows, placed } = stackRows(lane.appointments)
  const name = lane.isActive ? lane.name : `${lane.name}, ${inactiveWords[mode].toLowerCase()}`

  return (
    <div
      role="group"
      aria-label={name}
      className="col-span-full grid grid-cols-subgrid border-b last:border-b-0"
      style={{ gridRow: row, gridTemplateRows: `repeat(${rows}, 3.5rem)` }}
    >
      <div
        className={cn(
          "sticky left-0 z-10 col-start-1 flex min-w-0 flex-col justify-center gap-1 overflow-hidden border-r bg-card px-3 py-1",
          !lane.isActive && "text-muted-foreground"
        )}
        style={{ gridRow: "1 / -1" }}
      >
        <span className="truncate text-sm font-medium" title={lane.name}>
          {lane.name}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          {/* The employee number needs the wide lane column; the details sheet and lane filter name the technician anyway. */}
          {lane.detail && <span className="hidden shrink-0 font-mono text-2xs text-muted-foreground xl:inline">{lane.detail}</span>}
          {lane.isActive ? (
            <CapabilityBadges capabilities={lane.capabilities} certifications={lane.certifications} max={1} />
          ) : (
            <span className="w-fit shrink-0 rounded-full border border-dashed border-input px-2 text-2xs leading-5 font-medium">
              {inactiveWords[mode]}
            </span>
          )}
        </span>
      </div>
      {!lane.isActive && <div aria-hidden="true" className="bg-hatch" style={{ gridColumn: "2 / -1", gridRow: "1 / -1" }} />}
      {placed.map(({ item, row: stackRow }) => {
        const span = spanFor(item.startUtc, item.endUtc, grid)
        if (span.end <= span.start) return null
        return (
          <AppointmentBlock
            key={item.id}
            appointment={item}
            mode={mode}
            timeZone={timeZone}
            selected={item.id === selectedId}
            booked={item.id === bookedId}
            onSelect={onSelect}
            style={{ gridColumn: `${span.start + 1} / ${span.end + 1}`, gridRow: stackRow + 1 }}
          />
        )
      })}
    </div>
  )
}
