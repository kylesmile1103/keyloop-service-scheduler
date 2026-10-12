import { Plus, UsersRound, Warehouse } from "lucide-react"
import type { ReactNode } from "react"

import type { DealershipResponse } from "@/api/types.gen"
import { Button } from "@/components/ui/button"
import { TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

import type { Lane, LaneMode } from "../lib/schedule"
import { AutoRefreshSwitch } from "./auto-refresh-switch"
import { DateNavigator } from "./date-navigator"
import { FiltersSheet } from "./filters-sheet"
import { LaneFilterPopover } from "./lane-filter"

export interface BoardControls {
  dealership: DealershipResponse
  date: string
  today: string
  onDateChange: (date: string | null) => void
  mode: LaneMode
  /** The lanes of the current view, for the lane filter (empty until the schedule arrives). */
  lanes: readonly Lane[]
  hidden: ReadonlySet<string>
  onHiddenChange: (hidden: ReadonlySet<string>) => void
  autoRefresh: boolean
  onAutoRefreshChange: (on: boolean) => void
}

interface DispatchToolbarProps {
  /** The dealership select (always present, so its loading and failure states show). */
  dealershipSelect: ReactNode
  /** The day, lane and refresh controls, once a dealership is selected. */
  board?: BoardControls
  /** Opens the booking dialog (Task 17); the action is not shown until there is one. */
  onBookAppointment?: () => void
}

/**
 * The board's controls. Wide screens: dealership and day on the left; lane view, lane filter, auto-refresh and booking on
 * the right, wrapping into two clean rows below 1280 px. Phones: the dealership select at full width, the day control, then
 * the lane view with a Filters sheet holding auto-refresh, the lane filter and the legend.
 * The lane toggle is the tab list of the board's `Tabs` (the page wraps toolbar and board in it).
 */
export function DispatchToolbar({ dealershipSelect, board, onBookAppointment }: DispatchToolbarProps) {
  const isMobile = useIsMobile()

  // On a touch screen each tab is 44 px tall (the touch-target rule), so the list grows to hold it inside its 3 px inset:
  // `min-h-12.5` wins over the list's fixed height without a specificity contest.
  const laneTabs = (
    <TabsList
      aria-label="Lanes"
      className={cn("pointer-coarse:min-h-12.5", isMobile && "h-11 flex-1 group-data-horizontal/tabs:h-11")}
    >
      <TabsTrigger value="bays" className="cursor-pointer px-2.5 pointer-coarse:min-h-11">
        <Warehouse aria-hidden="true" />
        Bays
      </TabsTrigger>
      <TabsTrigger value="technicians" className="cursor-pointer px-2.5 pointer-coarse:min-h-11">
        <UsersRound aria-hidden="true" />
        Technicians
      </TabsTrigger>
    </TabsList>
  )
  const book = onBookAppointment && (
    <Button type="button" onClick={onBookAppointment} className="cursor-pointer pointer-coarse:h-11">
      <Plus aria-hidden="true" />
      Book appointment
    </Button>
  )

  if (isMobile) {
    return (
      <div className="flex flex-col gap-2">
        {dealershipSelect}
        {board && (
          <>
            <DateNavigator dealership={board.dealership} date={board.date} today={board.today} onDateChange={board.onDateChange} />
            {/* Stretched, so the Filters button matches the lane tabs' height on a touch screen. */}
            <div className="flex items-stretch gap-2">
              {laneTabs}
              <FiltersSheet
                lanes={board.lanes}
                mode={board.mode}
                hidden={board.hidden}
                onHiddenChange={board.onHiddenChange}
                autoRefresh={board.autoRefresh}
                onAutoRefreshChange={board.onAutoRefreshChange}
              />
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        {dealershipSelect}
        {board && <DateNavigator dealership={board.dealership} date={board.date} today={board.today} onDateChange={board.onDateChange} />}
      </div>
      {(board || book) && (
        // Right-aligned beside the day controls, so when the row runs out Book appointment ends the second row at the right
        // edge (Addendum B section B4) instead of sitting under the lane tabs.
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 xl:justify-end">
          {board && (
            <>
              {laneTabs}
              <LaneFilterPopover lanes={board.lanes} mode={board.mode} hidden={board.hidden} onHiddenChange={board.onHiddenChange} />
              <AutoRefreshSwitch checked={board.autoRefresh} onCheckedChange={board.onAutoRefreshChange} className="px-1" />
            </>
          )}
          {book}
        </div>
      )}
    </div>
  )
}
