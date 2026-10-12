import { cn } from "@/lib/utils"

/** Initials for an avatar: first and last name ("Amelia Clarke" → "AC"). */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words
  return letters.map((word) => word.charAt(0).toUpperCase()).join("")
}

const sizes = {
  /** Timeline blocks. */
  sm: "size-6 text-2xs",
  /** Job cards and sheets. */
  md: "size-8 text-xs",
  /** The signed-in account on Settings > Account. */
  lg: "size-12 text-base",
}

/**
 * A person's initials (first and last name) in Service Hub's round avatar (UI_DESIGN 11.9). Decorative: the name is
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
