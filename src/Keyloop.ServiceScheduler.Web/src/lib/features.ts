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

export interface Feature {
  label: string
  icon: LucideIcon
}

export const bayCapabilities: Record<BayCapability, Feature> = {
  StandardLift: { label: "Standard lift", icon: ArrowUpToLine },
  HeavyDutyLift: { label: "Heavy-duty lift", icon: Truck },
  EvHighVoltage: { label: "EV high voltage", icon: Zap },
  WheelAlignment: { label: "Wheel alignment", icon: Crosshair },
  Diagnostics: { label: "Diagnostics", icon: Activity },
  MotTesting: { label: "MOT testing", icon: ClipboardCheck },
  AirConditioning: { label: "Air-con", icon: Snowflake },
}

export const certifications: Record<Certification, Feature> = {
  GeneralService: { label: "General service", icon: Wrench },
  Brakes: { label: "Brakes", icon: Disc },
  HighVoltageElectrical: { label: "High-voltage electrical", icon: Zap },
  Diagnostics: { label: "Diagnostics", icon: Activity },
  MotTester: { label: "MOT tester", icon: ClipboardCheck },
  WheelAlignment: { label: "Wheel alignment", icon: Crosshair },
  AirConditioning: { label: "Air-con", icon: Snowflake },
  HeavyVehicle: { label: "Heavy vehicle", icon: Truck },
}

/** A capability's or certification's name for people ("EvHighVoltage" → "EV high voltage"); unknown names pass through. */
export function featureLabel(name: string): string {
  return (bayCapabilities as Record<string, Feature>)[name]?.label ?? (certifications as Record<string, Feature>)[name]?.label ?? name
}

// What every bay and every technician has says least about a lane, so it goes last.
const commonest = new Set<string>(["StandardLift", "GeneralService"])

/**
 * Equipment and certifications as `CapabilityBadges` lists them: the distinguishing ones first, each need once (a service
 * can need a capability and a certification of the same name, Diagnostics), and without what every bay and technician has
 * when `distinctiveOnly`. Empty when nothing is left to show.
 */
export function featureList(
  capabilities: readonly BayCapability[],
  certified: readonly Certification[],
  distinctiveOnly = false
): Array<Feature & { key: string; id: string }> {
  return [
    // The kind keeps the keys of a capability and a certification of the same name apart.
    ...capabilities.map((capability) => ({ key: capability, id: `bay-${capability}`, ...bayCapabilities[capability] })),
    ...certified.map((certification) => ({ key: certification, id: `technician-${certification}`, ...certifications[certification] })),
  ]
    .filter((feature) => !distinctiveOnly || !commonest.has(feature.key))
    // ...and then it is one need, said once: "Diagnostics", not "Diagnostics Diagnostics".
    .filter((feature, index, all) => all.findIndex((other) => other.label === feature.label) === index)
    .sort((a, b) => Number(commonest.has(a.key)) - Number(commonest.has(b.key)))
}
