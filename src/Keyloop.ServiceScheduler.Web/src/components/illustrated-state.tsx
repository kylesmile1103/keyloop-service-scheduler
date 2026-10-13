import type { ReactNode } from "react"

import { type Illustration, illustrationAlt, illustrations } from "@/lib/illustrations"
import { cn } from "@/lib/utils"

interface IllustratedStateProps {
  illustration: Illustration
  title: ReactNode
  /** The headline's level in the page outline: 1 on a page with no other title, 2 or 3 inside a view. */
  level?: 1 | 2 | 3
  /** One line saying why, or what to do next. */
  children?: ReactNode
  /** The one action the state offers. */
  action?: ReactNode
  /** `alert` for a failure the user should hear about at once. */
  role?: "alert" | "status"
  /** Exposes illustration alt text when the image conveys more than the heading; otherwise decorative (`alt=""`). */
  described?: boolean
  className?: string
}

/** Full-view empty or error state with an illustration, heading, description, and optional action. */
export function IllustratedState({ illustration, title, level = 3, children, action, role, described = false, className }: IllustratedStateProps) {
  const Heading = (["h1", "h2", "h3"] as const)[level - 1]
  return (
    <div role={role} className={cn("flex flex-col items-center gap-3 py-8 text-center", className)}>
      <img
        src={illustrations[illustration]}
        alt={described ? illustrationAlt[illustration] : ""}
        width={1200}
        height={900}
        draggable={false}
        className="pointer-events-none h-auto w-40 select-none md:w-48"
      />
      <Heading
        className={cn("font-heading font-semibold text-balance", level === 1 ? "text-xl font-bold tracking-tight md:text-2xl" : "text-lg")}
      >
        {title}
      </Heading>
      {children && <div className="flex max-w-xs flex-col items-center gap-2 text-sm text-pretty text-muted-foreground">{children}</div>}
      {action && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  )
}
