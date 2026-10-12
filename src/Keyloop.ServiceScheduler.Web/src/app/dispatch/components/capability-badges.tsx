import type { BayCapability, Certification } from "@/api/types.gen"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { bayCapabilities, certifications } from "../lib/features"

// What every bay and every technician has says least about a lane, so it goes last.
const commonest = new Set<string>(["StandardLift", "GeneralService"])

interface CapabilityBadgesProps {
  /** A bay's equipment. */
  capabilities?: readonly BayCapability[]
  /** A technician's certifications. */
  certifications?: readonly Certification[]
  /** Badges shown before the rest collapse into "+n" (with a tooltip naming them). */
  max?: number
  /** `outline` for what is missing (a 422 `no-qualified-resources`), `secondary` for what a bay or service has. */
  variant?: "secondary" | "outline"
  /** Leave out what every bay and technician has (a standard lift, general service). */
  distinctiveOnly?: boolean
  /** What assistive technology hears before the list ("Needs"); by default "Equipment", "Certified for" or "Missing". */
  label?: string
  className?: string
}

/**
 * What a bay is equipped for, or what a technician is certified for: the distinguishing features first, as small badges.
 * Assistive technology reads the whole list once; the badges themselves are visual.
 */
export function CapabilityBadges({
  capabilities = [],
  certifications: certified = [],
  max = 2,
  variant = "secondary",
  distinctiveOnly = false,
  label,
  className,
}: CapabilityBadgesProps) {
  const features = [
    // A service can need a capability and a certification of the same name (Diagnostics): the kind keeps their keys apart.
    ...capabilities.map((capability) => ({ key: capability, id: `bay-${capability}`, ...bayCapabilities[capability] })),
    ...certified.map((certification) => ({ key: certification, id: `technician-${certification}`, ...certifications[certification] })),
  ]
    .filter((feature) => !distinctiveOnly || !commonest.has(feature.key))
    // ...and then it is one need, said once: "Diagnostics", not "Diagnostics Diagnostics".
    .filter((feature, index, all) => all.findIndex((other) => other.label === feature.label) === index)
    .sort((a, b) => Number(commonest.has(a.key)) - Number(commonest.has(b.key)))
  if (features.length === 0) return null

  const shown = features.slice(0, max)
  const rest = features.slice(max)
  const heading = label ?? (variant === "outline" ? "Missing" : capabilities.length > 0 ? "Equipment" : "Certified for")

  return (
    <div className={cn("flex min-w-0 items-center gap-1 overflow-hidden", className)}>
      <span className="sr-only">{`${heading}: ${features.map((feature) => feature.label).join(", ")}.`}</span>
      {shown.map(({ id, label, icon: Icon }) => (
        <Badge key={id} variant={variant} aria-hidden="true" className="min-w-0 shrink font-normal">
          <Icon />
          <span className="truncate">{label}</span>
        </Badge>
      ))}
      {rest.length > 0 && (
        <Tooltip>
          <TooltipTrigger
            render={<Badge variant="outline" aria-hidden="true" className="shrink-0 font-normal tabular-nums" />}
          >{`+${rest.length}`}</TooltipTrigger>
          <TooltipContent side="bottom">{rest.map((feature) => feature.label).join(", ")}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
