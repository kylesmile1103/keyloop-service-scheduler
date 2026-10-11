import {
  Activity,
  ArrowUpToLine,
  ClipboardCheck,
  Crosshair,
  Disc,
  type LucideIcon,
  Snowflake,
  Truck,
  Wrench,
  Zap,
} from "lucide-react"

import type { BayCapability, Certification } from "@/api/types.gen"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface Feature {
  label: string
  icon: LucideIcon
}

const bayCapabilities: Record<BayCapability, Feature> = {
  StandardLift: { label: "Standard lift", icon: ArrowUpToLine },
  HeavyDutyLift: { label: "Heavy-duty lift", icon: Truck },
  EvHighVoltage: { label: "EV high voltage", icon: Zap },
  WheelAlignment: { label: "Wheel alignment", icon: Crosshair },
  Diagnostics: { label: "Diagnostics", icon: Activity },
  MotTesting: { label: "MOT testing", icon: ClipboardCheck },
  AirConditioning: { label: "Air-con", icon: Snowflake },
}

const certifications: Record<Certification, Feature> = {
  GeneralService: { label: "General service", icon: Wrench },
  Brakes: { label: "Brakes", icon: Disc },
  HighVoltageElectrical: { label: "High-voltage electrical", icon: Zap },
  Diagnostics: { label: "Diagnostics", icon: Activity },
  MotTester: { label: "MOT tester", icon: ClipboardCheck },
  WheelAlignment: { label: "Wheel alignment", icon: Crosshair },
  AirConditioning: { label: "Air-con", icon: Snowflake },
  HeavyVehicle: { label: "Heavy vehicle", icon: Truck },
}

// What every bay and every technician has says least about a lane, so it goes last.
const commonest = new Set<string>(["StandardLift", "GeneralService"])

interface CapabilityBadgesProps {
  /** A bay's equipment. */
  capabilities?: readonly BayCapability[]
  /** A technician's certifications. */
  certifications?: readonly Certification[]
  /** Badges shown before the rest collapse into "+n" (with a tooltip naming them). */
  max?: number
  className?: string
}

/**
 * What a bay is equipped for, or what a technician is certified for: the distinguishing features first, as small badges.
 * Assistive technology reads the whole list once; the badges themselves are visual.
 */
export function CapabilityBadges({ capabilities = [], certifications: certified = [], max = 2, className }: CapabilityBadgesProps) {
  const features = [
    ...capabilities.map((capability) => ({ key: capability, ...bayCapabilities[capability] })),
    ...certified.map((certification) => ({ key: certification, ...certifications[certification] })),
  ].sort((a, b) => Number(commonest.has(a.key)) - Number(commonest.has(b.key)))
  if (features.length === 0) return null

  const shown = features.slice(0, max)
  const rest = features.slice(max)
  const heading = capabilities.length > 0 ? "Equipment" : "Certified for"

  return (
    <div className={cn("flex min-w-0 items-center gap-1 overflow-hidden", className)}>
      <span className="sr-only">{`${heading}: ${features.map((feature) => feature.label).join(", ")}.`}</span>
      {shown.map(({ key, label, icon: Icon }) => (
        <Badge key={key} variant="secondary" aria-hidden="true" className="min-w-0 shrink font-normal">
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
