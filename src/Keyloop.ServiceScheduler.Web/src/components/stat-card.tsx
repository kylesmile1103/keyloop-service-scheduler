// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/users/components/stat-cards.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License.

import type { LucideIcon } from "lucide-react"
import { type ReactNode, useId } from "react"

import { Card, CardAction, CardDescription, CardFooter, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/** Placeholder shown when a card has no figure. */
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

/** Summary metric card with label, display figure, icon tile, optional meter, and context lines. */
export function StatCard({ label, icon: Icon, tile = "rounded-chip bg-secondary text-secondary-foreground", value, footer, detail, meter }: StatCardProps) {
  const labelId = useId()
  const loading = value === undefined

  return (
    <Card size="sm" role="group" aria-labelledby={labelId} aria-busy={loading || undefined} className="shadow-xs">
      <CardHeader>
        <CardDescription id={labelId}>{label}</CardDescription>
        <div data-slot="stat-card-value" className="font-heading text-2xl font-bold tracking-tight tabular-nums md:text-3xl">
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

/** Decorative horizontal meter bar representing a 0–1 ratio. */
export function ShareMeter({ share, className }: { share: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("mb-1 block h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <span className="block h-full rounded-full bg-chart-1" style={{ width: `${Math.min(Math.max(share, 0), 1) * 100}%` }} />
    </span>
  )
}
