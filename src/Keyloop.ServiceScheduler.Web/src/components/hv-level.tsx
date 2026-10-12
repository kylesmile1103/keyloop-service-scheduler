import { cn } from "@/lib/utils"
import { type HvLevel, hvLevels } from "@/lib/vehicle-aware"

/**
 * A technician's high-voltage competence as a four-step ladder (IMI levels 1 to 4), the steps filled up to the level: a
 * shape that reads at a glance in a table row, in the text's own colour (never a status hue), with the level written next
 * to it wherever it appears. Decorative: the words beside it carry the meaning.
 */
export function HvLadder({ level, className }: { level: HvLevel; className?: string }) {
  return (
    <span aria-hidden="true" data-slot="hv-ladder" data-level={level} className={cn("inline-flex h-3.5 shrink-0 items-end gap-0.5", className)}>
      {[1, 2, 3, 4].map((step) => (
        <span
          key={step}
          className={cn("w-[3px] rounded-[1px] bg-current", step > level && "opacity-20")}
          style={{ height: `${25 * step}%` }}
        />
      ))}
    </span>
  )
}

interface HvLevelBadgeProps {
  level: HvLevel
  /** "HV 3 Component repair" when true; "HV 3" alone otherwise. */
  named?: boolean
  /** A level that does not count today (expired): drawn dashed, and says so to assistive technology. */
  lapsed?: boolean
  className?: string
}

/** The level as a badge: the ladder and "HV 3", and its IMI name when there is room. */
export function HvLevelBadge({ level, named = false, lapsed = false, className }: HvLevelBadgeProps) {
  const { name } = hvLevels[level]
  return (
    <span
      data-slot="hv-level"
      className={cn(
        "inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-full border border-input px-2 text-xs font-medium whitespace-nowrap tabular-nums",
        lapsed && "border-dashed text-muted-foreground",
        className
      )}
    >
      <HvLadder level={level} />
      <span>{level === 0 ? "No HV" : `HV ${level}`}</span>
      {named && level > 0 && <span className="font-normal text-muted-foreground">{name}</span>}
      <span className="sr-only">{`, level ${level} of 4${named && level > 0 ? "" : `: ${name}`}${lapsed ? ", expired" : ""}`}</span>
    </span>
  )
}
