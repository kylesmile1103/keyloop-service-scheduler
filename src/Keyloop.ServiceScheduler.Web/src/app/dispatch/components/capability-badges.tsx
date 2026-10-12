import type { BayCapability, Certification } from "@/api/types.gen"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { featureList } from "../lib/features"

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
  /** An id for the spoken list, for a control that is described by it (`aria-describedby`): a suggested service's card. */
  descriptionId?: string
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
  descriptionId,
  className,
}: CapabilityBadgesProps) {
  const features = featureList(capabilities, certified, distinctiveOnly)
  if (features.length === 0) return null

  const shown = features.slice(0, max)
  const rest = features.slice(max)
  const heading = label ?? (variant === "outline" ? "Missing" : capabilities.length > 0 ? "Equipment" : "Certified for")

  return (
    <div className={cn("flex min-w-0 items-center gap-1 overflow-hidden", className)}>
      <span id={descriptionId} className="sr-only">{`${heading}: ${features.map((feature) => feature.label).join(", ")}.`}</span>
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

