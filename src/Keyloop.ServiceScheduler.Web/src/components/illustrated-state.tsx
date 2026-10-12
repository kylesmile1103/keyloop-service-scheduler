import type { ReactNode } from "react"

import { type Illustration, illustrations } from "@/lib/illustrations"
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
  /** A small tile over the illustration's corner that tells apart states sharing one picture (a key, a lock); decorative. */
  badge?: ReactNode
  className?: string
}

/**
 * A whole view's empty or error state: the illustration, a headline, one line and one action, in a centred column. The
 * headline says what the picture shows, so the image is decorative (`alt=""`, UI_DESIGN 12.4). Inline problems (409,
 * 422, 400, 429) are alerts next to what the user is doing, never one of these.
 */
export function IllustratedState({ illustration, title, level = 3, children, action, role, badge, className }: IllustratedStateProps) {
  const Heading = (["h1", "h2", "h3"] as const)[level - 1]
  const image = (
    <img
      src={illustrations[illustration]}
      alt=""
      width={1200}
      height={900}
      draggable={false}
      className="pointer-events-none h-auto w-40 select-none md:w-48"
    />
  )
  return (
    <div role={role} className={cn("flex flex-col items-center gap-3 py-8 text-center", className)}>
      {badge ? (
        <span className="relative">
          {image}
          <span aria-hidden="true" className="absolute right-1 bottom-3 md:right-2 md:bottom-4">
            {badge}
          </span>
        </span>
      ) : (
        image
      )}
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
