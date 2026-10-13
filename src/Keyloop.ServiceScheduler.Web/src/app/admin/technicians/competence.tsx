import { BadgeCheck, CircleDashed, LoaderCircle, ShieldAlert } from "lucide-react"

import { HvLevelBadge } from "@/components/hv-level"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDay } from "@/lib/calendar-date"
import { cn } from "@/lib/utils"

import type { Competence } from "./competence-model"

/** The dashed "needs review" pill: a migrated level nobody has confirmed. Words and shape, never colour alone. */
export function NeedsReview({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 w-fit shrink-0 items-center gap-1 rounded-full border border-dashed border-input px-2 text-xs font-medium whitespace-nowrap text-muted-foreground",
        className
      )}
    >
      <CircleDashed aria-hidden="true" className="size-3.5" />
      Unconfirmed, needs review
    </span>
  )
}

/** When the level stops counting: "until 31 Dec 2028", or that it expired and counts as none. */
function validity(competence: Competence): { text: string; expired: boolean } | null {
  if (competence.expired && competence.validUntil) {
    return { text: `Expired ${formatDay(competence.validUntil, "dated")}: counts as no HV training`, expired: true }
  }
  if (competence.validUntil && competence.level > 0) return { text: `Valid until ${formatDay(competence.validUntil, "dated")}`, expired: false }
  return null
}

/** The table's cell: the level, its validity under it, and the review pill when nobody confirmed it. */
export function CompetenceCell({ competence }: { competence: Competence | null }) {
  if (!competence) return <span className="text-muted-foreground">Not shown</span>
  const valid = validity(competence)
  return (
    <span className="flex max-w-60 min-w-0 flex-col items-start gap-1 py-1">
      <span className="flex flex-wrap items-center gap-1.5">
        <HvLevelBadge level={competence.level} named lapsed={competence.expired} />
        {!competence.confirmed && <NeedsReview />}
      </span>
      {valid && <span className={cn("text-xs", valid.expired ? "font-medium text-destructive" : "text-muted-foreground")}>{valid.text}</span>}
    </span>
  )
}

/** Brand specialisms as quiet badges; allocation does not use them yet, which the column header says. */
export function BrandsCell({ competence }: { competence: Competence | null }) {
  if (!competence || competence.brands.length === 0) return <span className="text-muted-foreground">None</span>
  return (
    <span className="flex flex-wrap gap-1">
      {competence.brands.map((brand) => (
        <Badge key={brand} variant="outline" className="font-mono font-normal tracking-wide">
          {brand}
        </Badge>
      ))}
    </span>
  )
}

/** The phone card's competence: the same facts, stacked, with the brands' caveat in words. */
export function CompetenceBlock({ competence }: { competence: Competence | null }) {
  if (!competence) return null
  const valid = validity(competence)
  return (
    <div className="flex flex-col gap-1.5 border-t pt-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <HvLevelBadge level={competence.level} named lapsed={competence.expired} />
        {!competence.confirmed && <NeedsReview />}
      </div>
      {valid && <p className={cn("text-xs", valid.expired ? "font-medium text-destructive" : "text-muted-foreground")}>{valid.text}</p>}
      {competence.brands.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="font-mono tracking-wide text-foreground">{competence.brands.join(", ")}</span>
          {" specialist, not used for allocation yet"}
        </p>
      )}
    </div>
  )
}

/** A technician whose level nobody confirmed, for the note above the roster. */
export interface UnconfirmedLevel {
  id: string
  name: string
}

interface UnconfirmedLevelsNoteProps {
  levels: readonly UnconfirmedLevel[]
  /** An Admin confirms each from the note (Task 30b); anyone else is told who can. */
  onConfirm?: (id: string) => void
  /** Technicians whose confirmation is being sent. */
  pending?: ReadonlySet<string>
}

/**
 * Above the roster when a level nobody confirmed is on it: who, why (the migration carried the old high-voltage certificate
 * over as level 3 and every other technician as level 0), and that it still counts when booking. An Admin gets a Confirm
 * button per technician, one action each (Task 30b, UI_DESIGN 11.24); a Service advisor or a Viewer is told an Admin can.
 */
export function UnconfirmedLevelsNote({ levels, onConfirm, pending = new Set() }: UnconfirmedLevelsNoteProps) {
  if (levels.length === 0) return null
  const names = levels.map((level) => level.name)
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
  return (
    <section
      aria-label="HV levels to review"
      className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-subtle px-4 py-3 text-sm text-foreground"
    >
      <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-pretty">
        <p className="font-semibold text-warning">{`${names.length} HV ${names.length === 1 ? "level needs" : "levels need"} review`}</p>
        <p>{`${list}: carried over from the old high-voltage certificate (as level 3, everyone else as level 0) and not confirmed by anyone.`}</p>
        <p className="text-muted-foreground">
          {`An unconfirmed level still counts when booking, so a technician at level 0 can’t take work on a vehicle that may be high-voltage, which includes every booking without a declared powertrain. ${
            onConfirm
              ? "Confirm a level once you have checked it, or edit it if it is wrong. On a demo database, Reseed demo data (Admin) restores the seeded, confirmed levels."
              : "A workshop Admin confirms or corrects them; on a demo database, Reseed demo data (Admin) restores the seeded, confirmed levels."
          }`}
        </p>
        {onConfirm && (
          <ul className="flex flex-wrap gap-2 pt-1">
            {levels.map((level) => (
              <li key={level.id}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending.has(level.id)}
                  focusableWhenDisabled
                  onClick={() => onConfirm(level.id)}
                  data-record-id={level.id}
                  className="cursor-pointer bg-card"
                >
                  {pending.has(level.id) ? (
                    <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <BadgeCheck aria-hidden="true" />
                  )}
                  {`Confirm ${level.name}'s level`}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
