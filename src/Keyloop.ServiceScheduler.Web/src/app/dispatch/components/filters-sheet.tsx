import { SlidersHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"

import type { Lane, LaneMode } from "../lib/schedule"
import { AutoRefreshSwitch } from "./auto-refresh-switch"
import { LaneFilterList } from "./lane-filter"
import { StatusLegend } from "./status-legend"

interface FiltersSheetProps {
  lanes: readonly Lane[]
  mode: LaneMode
  hidden: ReadonlySet<string>
  onHiddenChange: (hidden: ReadonlySet<string>) => void
  autoRefresh: boolean
  onAutoRefreshChange: (on: boolean) => void
}

/** On a phone, the toolbar's secondary controls live in a bottom sheet: auto-refresh, the lane filter and the legend. */
export function FiltersSheet({ lanes, mode, hidden, onHiddenChange, autoRefresh, onAutoRefreshChange }: FiltersSheetProps) {
  const shown = lanes.filter((lane) => !hidden.has(lane.id)).length

  return (
    <Sheet>
      <SheetTrigger render={<Button type="button" variant="outline" className="h-auto min-h-11 shrink-0 cursor-pointer" />}>
        <SlidersHorizontal aria-hidden="true" className="text-muted-foreground" />
        Filters
        {shown < lanes.length && (
          <span className="text-muted-foreground tabular-nums">
            <span className="sr-only">, </span>
            {`${shown}/${lanes.length}`}
          </span>
        )}
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] gap-0 rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))] *:data-[slot=sheet-close]:size-11"
      >
        <div aria-hidden="true" className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/40" />
        <SheetHeader>
          <SheetTitle>Board options</SheetTitle>
          <SheetDescription>Refresh, lanes and the status colours.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-2">
          <AutoRefreshSwitch checked={autoRefresh} onCheckedChange={onAutoRefreshChange} className="min-h-11" />
          <Separator />
          <section aria-labelledby="filters-lanes" className="flex flex-col gap-1">
            <h3 id="filters-lanes" className="text-sm font-medium">
              {mode === "bays" ? "Bays" : "Technicians"}
            </h3>
            <LaneFilterList lanes={lanes} mode={mode} hidden={hidden} onHiddenChange={onHiddenChange} />
          </section>
          <Separator />
          <section aria-labelledby="filters-legend" className="flex flex-col gap-2">
            <h3 id="filters-legend" className="text-sm font-medium">
              Status colours
            </h3>
            <StatusLegend className="text-sm" />
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}
