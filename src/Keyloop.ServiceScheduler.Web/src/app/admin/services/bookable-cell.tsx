import { Check } from "lucide-react"

import { CapabilityBadges } from "@/components/capability-badges"
import { cn } from "@/lib/utils"

import type { ServiceRecord } from "../lib/resources"

/** Said when every need exists at the dealership, but not together on one active bay and one active technician. */
export const NO_SINGLE_MATCH = "No single bay and technician has all it needs"

/**
 * Whether the dealership can book a service: "Yes", or "No" with what it lacks as outline badges (the booking dialog's
 * `422 no-qualified-resources` treatment, UI_DESIGN 11.6), or, when each need exists but not together, a sentence.
 */
export function BookableState({ service, className }: { service: ServiceRecord; className?: string }) {
  if (service.bookable) {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <Check aria-hidden="true" className="size-4 text-muted-foreground" />
        Yes
      </span>
    )
  }
  const shortfall = service.shortfall
  const named = shortfall && shortfall.capabilities.length + shortfall.certifications.length > 0
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-dashed border-input px-2 text-xs font-medium text-muted-foreground">
        No
      </span>
      {named ? (
        <CapabilityBadges capabilities={shortfall.capabilities} certifications={shortfall.certifications} variant="outline" max={2} />
      ) : (
        <span className="min-w-0 truncate text-xs text-muted-foreground" title={NO_SINGLE_MATCH}>
          {NO_SINGLE_MATCH}
        </span>
      )}
    </span>
  )
}
