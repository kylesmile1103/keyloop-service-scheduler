// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/dashboard-2/components/revenue-breakdown.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { useId, useMemo } from "react"

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

import { serviceMix } from "../lib/overview"

const percent = (share: number) => `${Math.round(share * 100)}%`

const OTHER = "other"
const SHOWN = 6

/** Horizontal bar breakdown of bookings by service type over the overview window. */
export function ServiceMix({ appointments }: { appointments: Parameters<typeof serviceMix>[0] | undefined }) {
  const mix = useMemo(() => (appointments ? serviceMix(appointments, SHOWN) : undefined), [appointments])
  const headingId = useId()
  const rows = mix ? [...mix.services, ...(mix.other ? [{ id: OTHER, name: `Other services (${mix.other.services})`, ...mix.other }] : [])] : []
  const largest = Math.max(1, ...rows.map((row) => row.count))

  return (
    <Card className="min-w-0 shadow-xs" role="region" aria-labelledby={headingId}>
      <CardHeader>
        <h2 id={headingId} className="font-heading text-lg leading-snug font-semibold">
          Service mix
        </h2>
        <CardDescription>Bookings by service over the same days.</CardDescription>
      </CardHeader>
      <CardContent>
        {!mix ? (
          <div aria-busy="true" className="flex flex-col gap-4">
            {[0, 1, 2, 3, 4].map((index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </div>
        ) : mix.total === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing booked in these days.</p>
        ) : (
          <ul aria-labelledby={headingId} className="flex flex-col gap-3.5">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-1.5">
                <span className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium" title={row.name}>
                    {row.name}
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    <span className="font-heading font-semibold text-foreground">{row.count}</span>
                    <span className="sr-only">{row.count === 1 ? " booking," : " bookings,"}</span>
                    <span aria-hidden="true">{" · "}</span>
                    {percent(row.share)}
                  </span>
                </span>
                <span aria-hidden="true" className="block h-2 overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn("block h-full rounded-full", row.id === OTHER ? "bg-input" : "bg-chart-1")}
                    style={{ width: `${(row.count / largest) * 100}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
