import { BadgeCheck, CircleQuestionMark, IdCard, type LucideIcon, ScanBarcode, UserPen } from "lucide-react"

import type { ProfileSource } from "@/api/types.gen"
import { cn } from "@/lib/utils"
import { provenanceLabels } from "@/lib/vehicle-aware"

const looks: Record<ProfileSource, { icon: LucideIcon; className: string }> = {
  // Evidence the system read for itself: a quiet filled chip.
  VinDecoded: { icon: ScanBarcode, className: "bg-secondary text-secondary-foreground" },
  RegistryLookup: { icon: IdCard, className: "bg-secondary text-secondary-foreground" },
  // A person said so, and is accountable for it: an outlined chip.
  Declared: { icon: UserPen, className: "border border-input text-foreground" },
  SuggestedConfirmed: { icon: BadgeCheck, className: "border border-input text-foreground" },
  // Nobody knows yet: the dashed outline the app uses for what is missing.
  Unknown: { icon: CircleQuestionMark, className: "border border-dashed border-input text-muted-foreground" },
}

/** Chip indicating the provenance of a vehicle profile attribute ("from VIN", "declared", "not known"). */
export function ProvenanceChip({ source, className }: { source: ProfileSource; className?: string }) {
  const { icon: Icon, className: look } = looks[source]
  return (
    <span
      data-slot="provenance-chip"
      data-source={source}
      className={cn("inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-full px-1.5 text-2xs font-medium whitespace-nowrap", look, className)}
    >
      <Icon aria-hidden="true" className="size-3" />
      <span className="sr-only">, </span>
      {provenanceLabels[source]}
    </span>
  )
}
