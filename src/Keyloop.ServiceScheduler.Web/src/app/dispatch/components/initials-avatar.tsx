import { cn } from "@/lib/utils"

import { initials } from "../lib/appointment-text"

const sizes = {
  /** Timeline blocks. */
  sm: "size-6 text-2xs",
  /** Job cards and sheets. */
  md: "size-8 text-xs",
}

/**
 * A technician's initials (first and last name) in Service Hub's round avatar (DESIGN_SYSTEM 11.9). Decorative: the name is
 * always written next to it or in the element's accessible name. `ring` separates it from a status tint it overlaps.
 */
export function InitialsAvatar({
  name,
  size = "md",
  ring = false,
  className,
}: {
  name: string
  size?: keyof typeof sizes
  ring?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground tabular-nums",
        sizes[size],
        ring && "ring-2 ring-card",
        className
      )}
    >
      {initials(name)}
    </span>
  )
}
