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
export function BoardPlaceholder({ hours = workingDay, loading = false, closed = false, children }: BoardPlaceholderProps) {
  const columns: CSSProperties = { gridTemplateColumns: `11rem repeat(${hours.length}, minmax(0, 1fr))` }
  const cell = (column: number): CSSProperties => ({ gridRow: 1, gridColumn: column })

  return (
    <Card className="relative gap-0 overflow-hidden py-0" aria-busy={loading || undefined}>
      <div aria-hidden="true" className="pointer-events-none select-none">
        <div className="grid border-b text-xs text-muted-foreground tabular-nums" style={columns}>
          <div className="px-4 py-2.5">Bay</div>
          {hours.map((hour) => (
            <div key={hour} className="border-l px-2 py-2.5">
              {hour}
            </div>
          ))}
        </div>
        {Array.from({ length: lanes }, (_, lane) => (
          <div key={lane} className="grid h-14 border-b last:border-b-0" style={columns}>
            <div className="flex items-center px-4" style={cell(1)}>
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
              shimmer[lane]
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
      {children && <div className="absolute inset-0 flex items-center justify-center p-6">{children}</div>}
    </Card>
  )
}

interface BoardMessageProps {
  icon: LucideIcon
  title: string
  children: ReactNode
  action?: ReactNode
}

/** A short explanation over the empty frame: what the board shows, or why it shows nothing, and what to do next. */
export function BoardMessage({ icon: Icon, title, children, action }: BoardMessageProps) {
  return (
    <div className="flex max-w-sm flex-col items-center gap-2 rounded-xl bg-card/95 px-6 py-5 text-center ring-1 ring-foreground/5">
      <div className="mb-1 flex size-10 items-center justify-center rounded-lg border bg-background">
        <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <h2 className="text-base font-semibold text-balance">{title}</h2>
      <div className="flex flex-col gap-1 text-sm text-pretty text-muted-foreground">{children}</div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
