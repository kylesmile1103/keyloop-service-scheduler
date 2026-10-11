import type { LucideIcon } from "lucide-react"
import type { CSSProperties, ReactNode } from "react"

import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const workingDay = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"]
const lanes = 4
// Where the loading shimmer draws "bookings" on each lane: [first hour column, hour columns spanned]
const shimmer: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[1, 2], [5, 3]],
  [[2, 3]],
  [[0, 2], [4, 2], [8, 2]],
  [[3, 4]],
]

interface BoardPlaceholderProps {
  /** Hour marks along the top; an 08:00–18:00 day when omitted. */
  hours?: readonly string[]
  /** The lane column's heading. */
  laneLabel?: string
  /** Inside the board's own card: no card of its own. */
  framed?: boolean
  /** Shimmering lanes while the board's data loads. */
  loading?: boolean
  /** Hatched lanes: the workshop is not working that day. */
  closed?: boolean
  /** What to say over the empty frame (a `BoardMessage` or an alert). */
  children?: ReactNode
}

/**
 * The timeline's frame without bookings: an hour ruler and four empty lanes. It holds the board's place while data loads, and
 * carries a message when there is nothing to draw, so the page keeps its shape between states.
 */
export function BoardPlaceholder({
  hours = workingDay,
  laneLabel = "Bay",
  framed = true,
  loading = false,
  closed = false,
  children,
}: BoardPlaceholderProps) {
  const columns: CSSProperties = { gridTemplateColumns: `var(--lane-width) repeat(${hours.length}, minmax(0, 1fr))` }
  const cell = (column: number): CSSProperties => ({ gridRow: 1, gridColumn: column })
  const Frame = framed ? Card : "div"

  return (
    <Frame
      className={cn(
        "relative gap-0 overflow-hidden py-0 [--lane-width:10rem] xl:[--lane-width:13.75rem]",
        // With a message on it, the frame grows to the message; the empty grid stays behind as the board's shape.
        children && "min-h-64"
      )}
      aria-busy={loading || undefined}
    >
      <div aria-hidden="true" className={cn("pointer-events-none select-none", children && "absolute inset-0 overflow-hidden")}>
        <div className="grid border-b text-xs text-muted-foreground tabular-nums" style={columns}>
          <div className="px-3 py-2.5">{laneLabel}</div>
          {hours.map((hour) => (
            <div key={hour} className="border-l px-2 py-2.5">
              {hour}
            </div>
          ))}
        </div>
        {Array.from({ length: children ? lanes * 2 : lanes }, (_, lane) => (
          <div key={lane} className="grid h-14 border-b last:border-b-0" style={columns}>
            <div className="flex items-center px-3" style={cell(1)}>
              {loading && <Skeleton className="h-3 w-24" />}
            </div>
            {hours.map((hour, index) => (
              <div
                key={hour}
                className={cn("border-l border-dashed border-border/70", closed && "bg-hatch")}
                style={cell(index + 2)}
              />
            ))}
            {loading &&
              shimmer[lane % lanes]
                .filter(([start]) => start < hours.length)
                .map(([start, span]) => (
                  <Skeleton
                    key={start}
                    className="mx-0.5 my-2.5 rounded-md"
                    style={{ gridRow: 1, gridColumn: `${start + 2} / span ${Math.min(span, hours.length - start)}` }}
                  />
                ))}
          </div>
        ))}
      </div>
      {children && <div className="relative flex items-center justify-center px-4 pt-14 pb-6 md:px-6">{children}</div>}
    </Frame>
  )
}

/** A panel that lifts a message off the empty frame behind it. */
export function BoardPanel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("w-full max-w-md rounded-xl bg-card/95 px-6 shadow-sm ring-1 ring-foreground/10", className)}>{children}</div>
}

interface BoardMessageProps {
  icon: LucideIcon
  title: string
  /** The heading level in the page outline: 2 on its own, 3 inside the board (under the dealership's heading). */
  level?: 2 | 3
  children: ReactNode
  action?: ReactNode
}

/** A short explanation over the empty frame: what the board shows, or why it shows nothing, and what to do next. */
export function BoardMessage({ icon: Icon, title, level = 2, children, action }: BoardMessageProps) {
  const Heading = level === 2 ? "h2" : "h3"
  return (
    <div className="flex max-w-sm flex-col items-center gap-2 rounded-xl bg-card/95 px-6 py-5 text-center shadow-sm ring-1 ring-foreground/10">
      <div className="mb-1 flex size-9 items-center justify-center rounded-chip bg-secondary text-secondary-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <Heading className="font-heading text-lg font-semibold text-balance">{title}</Heading>
      <div className="flex flex-col gap-1 text-sm text-pretty text-muted-foreground">{children}</div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
