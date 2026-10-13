import { Check } from "lucide-react"

import { CapabilityBadges } from "@/components/capability-badges"
import { cn } from "@/lib/utils"

import { type ServiceRecord, splitSentence } from "../lib/resources"

/** Displays whether a service is bookable at the dealership, or the missing capabilities/certifications. */
export function BookableState({ service, className }: { service: ServiceRecord; className?: string }) {
  if (service.bookable) {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <Check aria-hidden="true" className="size-4 text-muted-foreground" />
        Yes
      </span>
    )
  }
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <NotHere />
      <Shortfall service={service} max={1} />
    </span>
  )
}

/** The dashed "No" pill: the board's pill for what is not in service, here for a service the dealership cannot book. */
export function NotHere() {
  return (
    <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-dashed border-input px-2 text-xs font-medium text-muted-foreground">
      No
    </span>
  )
}

/** What the dealership lacks for a service: the missing needs as outline badges, then a split need in words. */
export function Shortfall({ service, max, wrap = false }: { service: ServiceRecord; max: number; wrap?: boolean }) {
  const shortfall = service.shortfall
  if (!shortfall) return null
  const split = splitSentence(shortfall)
  const missing = shortfall.capabilities.length + shortfall.certifications.length > 0
  return (
    <span className={cn("flex min-w-0 items-center gap-2", wrap && "flex-wrap")}>
      {missing && (
        <CapabilityBadges
          capabilities={shortfall.capabilities}
          certifications={shortfall.certifications}
          variant="outline"
          max={max}
          className={cn(wrap && "flex-wrap")}
        />
      )}
      {split && <span className="min-w-0 truncate text-xs text-muted-foreground">{split}</span>}
    </span>
  )
}
