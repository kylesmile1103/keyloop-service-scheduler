import { Badge } from "@/components/ui/badge"
import { ShareMeter } from "@/components/stat-card"
import { cn } from "@/lib/utils"

import { type DayLoad, formatMinutes } from "../lib/resources"

/**
 * Whether a technician takes bookings, or a bay is in service: the active state a quiet pill, the inactive one the board's
 * dashed pill (its lanes say "Inactive" and "Out of service" the same way). Words and shape, never colour alone.
 */
export function ActiveState({ active, words }: { active: boolean; words: { active: string; inactive: string } }) {
  return active ? (
    <Badge variant="secondary" className="font-normal">
      {words.active}
    </Badge>
  ) : (
    <span className="inline-flex h-6 w-fit shrink-0 items-center rounded-full border border-dashed border-input px-2 text-xs font-medium whitespace-nowrap text-muted-foreground">
      {words.inactive}
    </span>
  )
}

const percentOf = (load: DayLoad) =>
  load.windowMinutes && load.windowMinutes > 0 ? Math.round((load.bookedMinutes / load.windowMinutes) * 100) : 0

/**
 * Today's booked time as a thin meter of the opening hours (UI_DESIGN 13, `chart-1`) and the time in words, or the share
 * as a percentage (a bay's load). "Closed" on a day the dealership does not open.
 */
export function LoadCell({ load, show, className }: { load: DayLoad; show: "time" | "share"; className?: string }) {
  if (load.windowMinutes === null) return <span className="text-muted-foreground">Closed</span>
  const share = load.windowMinutes > 0 ? load.bookedMinutes / load.windowMinutes : 0
  return (
    <span
      className={cn("inline-flex items-center justify-end gap-2.5", className)}
      title={`${formatMinutes(load.bookedMinutes)} booked of ${formatMinutes(load.windowMinutes)}`}
    >
      <ShareMeter share={share} className="mb-0 w-14 shrink-0 max-sm:w-10" />
      <span className="min-w-14 tabular-nums">{show === "share" ? `${percentOf(load)}%` : formatMinutes(load.bookedMinutes)}</span>
    </span>
  )
}
