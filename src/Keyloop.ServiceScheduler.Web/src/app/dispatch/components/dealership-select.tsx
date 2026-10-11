import { Building2 } from "lucide-react"

import type { DealershipResponse } from "@/api/types.gen"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

/** Where the list stands; only a `ready` list can be opened (the board explains an `empty` or `failed` one). */
export type DealershipListStatus = "loading" | "ready" | "empty" | "failed"

interface DealershipSelectProps {
  dealerships: readonly DealershipResponse[] | undefined
  value: string | undefined
  onValueChange: (dealershipId: string) => void
  status: DealershipListStatus
}

const placeholders: Record<DealershipListStatus, string> = {
  loading: "Loading dealerships…",
  ready: "Choose a dealership",
  empty: "No dealerships",
  failed: "Dealerships unavailable",
}

/**
 * Which workshop the board shows. Each option names the dealership's time zone: the board's times are that dealership's
 * local times.
 */
export function DealershipSelect({ dealerships = [], value, onValueChange, status }: DealershipSelectProps) {
  const items = dealerships.map((dealership) => ({ value: dealership.id, label: dealership.name }))

  return (
    <>
      <Label htmlFor="dealership-select" className="sr-only">
        Dealership
      </Label>
      <Select
        items={items}
        value={value ?? null}
        onValueChange={(id) => id && onValueChange(id)}
        disabled={status !== "ready"}
      >
        <SelectTrigger id="dealership-select" className="w-64 cursor-pointer" aria-busy={status === "loading"}>
          <Building2 aria-hidden="true" className="text-muted-foreground" />
          <SelectValue placeholder={placeholders[status]} className="truncate" />
        </SelectTrigger>
        {/* Below the trigger, right-aligned to it: aligning the chosen item over the trigger would shift the list sideways
            by the width of the trigger's icon. */}
        <SelectContent alignItemWithTrigger={false} align="end">
          {dealerships.map((dealership) => (
            <SelectItem key={dealership.id} value={dealership.id} className="py-1.5">
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{dealership.name}</span>
                <span className="text-xs text-muted-foreground">{dealership.timeZoneId}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  )
}
