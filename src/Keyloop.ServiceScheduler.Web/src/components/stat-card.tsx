// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/users/components/stat-cards.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).

import type { LucideIcon } from "lucide-react"
import { type ReactNode, useId } from "react"

import { Card, CardAction, CardDescription, CardFooter, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/** What a card shows when it has no figure (its data failed to load, or the day is closed); read out in words. */
export const NO_FIGURE = "–"

interface StatCardProps {
  label: string
  icon: LucideIcon
  /** The icon tile's colours: a status's tint and ink, or the neutral tile. */
  tile?: string
  /** `undefined` while loading; `NO_FIGURE` when there is none. */
  value: string | undefined
  footer: ReactNode
  detail: ReactNode
  /** A thin bar under the figure: a share (`ShareMeter`) or the day by status. */
  meter?: ReactNode
}

/**
 * One figure in a page's row of cards (UI_DESIGN 11.11), in place of the template's icon-above-title layout: the label,
 * the figure in the display face, a context line and an icon tile. No trend badges or "from previous" lines: the API keeps
 * no history to compare with (UI_DESIGN 11.19).
 */
export function StatCard({ label, icon: Icon, tile = "rounded-chip bg-secondary text-secondary-foreground", value, footer, detail, meter }: StatCardProps) {
  const labelId = useId()
  const loading = value === undefined

  return (
    <Card size="sm" role="group" aria-labelledby={labelId} aria-busy={loading || undefined} className="shadow-xs">
      <CardHeader>
        <CardDescription id={labelId}>{label}</CardDescription>
        <div className="font-heading text-2xl font-bold tracking-tight tabular-nums md:text-3xl">
          {loading ? (
            <Skeleton className="my-1 h-7 w-12" />
          ) : value === NO_FIGURE ? (
            <>
              <span aria-hidden="true">{NO_FIGURE}</span>
              <span className="sr-only">No figure</span>
            </>
          ) : (
            value
          )}
        </div>
        <CardAction>
          <span aria-hidden="true" className={cn("flex size-9 items-center justify-center max-md:size-8", tile)}>
            <Icon className="size-5 max-md:size-4" />
          </span>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 border-t-0 bg-transparent pt-0">
        {meter}
        {loading ? <Skeleton className="h-4 w-3/4" /> : <div className="line-clamp-2 text-xs text-pretty text-muted-foreground">{footer}</div>}
        <div className="line-clamp-1 text-xs text-muted-foreground max-md:hidden">{detail}</div>
      </CardFooter>
    </Card>
  )
}

/**
 * A share from 0 to 1 as a thin meter (UI_DESIGN 13: an `h-1.5` muted track with a `chart-1` fill). Decorative: the figure
 * or the text beside it says the same in words.
 */
export function ShareMeter({ share, className }: { share: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("mb-1 block h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <span className="block h-full rounded-full bg-chart-1" style={{ width: `${Math.min(Math.max(share, 0), 1) * 100}%` }} />
    </span>
  )
}
