import { CalendarRange } from "lucide-react"

import { Card } from "@/components/ui/card"

const hours = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"]
const lanes = 4
const columns = "grid grid-cols-[11rem_repeat(10,minmax(0,1fr))]"

/** The board before a dealership is chosen: the timeline's frame, empty, with what to expect. */
export function BoardPlaceholder() {
  return (
    <Card className="relative gap-0 py-0">
      <div aria-hidden="true" className="pointer-events-none select-none">
        <div className={`${columns} border-b text-xs text-muted-foreground tabular-nums`}>
          <div className="px-4 py-2.5">Bay</div>
          {hours.map((hour) => (
            <div key={hour} className="border-l px-2 py-2.5">
              {hour}
            </div>
          ))}
        </div>
        {Array.from({ length: lanes }, (_, lane) => (
          <div key={lane} className={`${columns} h-14 border-b last:border-b-0`}>
            <div />
            {hours.map((hour) => (
              <div key={hour} className="border-l border-dashed border-border/70" />
            ))}
          </div>
        ))}
      </div>
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div className="flex max-w-sm flex-col items-center gap-2 rounded-xl bg-card/95 px-6 py-5 text-center ring-1 ring-foreground/5">
          <div className="mb-1 flex size-10 items-center justify-center rounded-lg border bg-background">
            <CalendarRange className="size-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <h2 className="text-base font-semibold">No dealership selected</h2>
          <p className="text-sm text-muted-foreground">
            Bays, technicians and the day’s appointments appear here once a dealership is selected.
          </p>
        </div>
      </div>
    </Card>
  )
}
