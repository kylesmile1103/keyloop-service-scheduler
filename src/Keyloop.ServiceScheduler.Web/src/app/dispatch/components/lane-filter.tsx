// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/calendar/components/calendars.tsx` and
// `src/app/calendar/components/calendar-sidebar.tsx`, Copyright (c) 2025 ShadcnStore, MIT License (the full notice is
// in the README's licence section).
import { ListFilter } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

import type { Lane, LaneMode } from "../lib/schedule"

interface LaneFilterProps {
  lanes: readonly Lane[]
  mode: LaneMode
  /** Ids of the lanes the board leaves out. */
  hidden: ReadonlySet<string>
  onHiddenChange: (hidden: ReadonlySet<string>) => void
}

/**
 * Which lanes the board shows, one checkbox per bay or technician (the template calendar's "calendars" list, without its
 * demo groups and colours: on this board colour belongs to appointment status).
 */
export function LaneFilterList({ lanes, mode, hidden, onHiddenChange }: LaneFilterProps) {
  const toggle = (id: string, shown: boolean) => {
    const next = new Set(hidden)
    if (shown) next.delete(id)
    else next.add(id)
    onHiddenChange(next)
  }
  const anyHidden = lanes.some((lane) => hidden.has(lane.id))

  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col">
        {lanes.map((lane) => (
          <li key={lane.id}>
            <Label className="flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 font-normal hover:bg-accent/50 max-md:min-h-11 pointer-coarse:min-h-11">
              <Checkbox checked={!hidden.has(lane.id)} onCheckedChange={(checked) => toggle(lane.id, checked)} />
              <span className={cn("min-w-0 flex-1 truncate", !lane.isActive && "text-muted-foreground")}>{lane.name}</span>
              {!lane.isActive && (
                <span className="shrink-0 text-xs text-muted-foreground">{mode === "bays" ? "Out of service" : "Inactive"}</span>
              )}
            </Label>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start max-md:h-11 pointer-coarse:h-11"
        disabled={!anyHidden}
        // Pressed, it disables itself; focus stays on it, inside the filter.
        focusableWhenDisabled
        onClick={() => onHiddenChange(new Set())}
      >
        Show all
      </Button>
    </div>
  )
}

/** The lane filter in a toolbar popover, with how many lanes are showing. */
export function LaneFilterPopover(props: LaneFilterProps) {
  const { lanes, mode, hidden } = props
  const shown = lanes.filter((lane) => !hidden.has(lane.id)).length

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            aria-label={`Lanes, ${shown} of ${lanes.length} shown`}
            className="cursor-pointer pointer-coarse:h-11"
          />
        }
      >
        <ListFilter aria-hidden="true" className="text-muted-foreground" />
        Lanes
        <span className="text-muted-foreground tabular-nums">{`${shown}/${lanes.length}`}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <PopoverHeader>
          <PopoverTitle>Lanes</PopoverTitle>
          <PopoverDescription>{mode === "bays" ? "Choose the bays the board shows." : "Choose the technicians the board shows."}</PopoverDescription>
        </PopoverHeader>
        <LaneFilterList {...props} />
      </PopoverContent>
    </Popover>
  )
}
