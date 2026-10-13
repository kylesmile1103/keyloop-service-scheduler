// Adopted from shadcn-dashboard-landing-template (vite-version) `src/components/site-header.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License.
"use client"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { ModeToggle } from "@/components/mode-toggle"

/** Offsets focus ring against the work surface background when rendered over the header band. */
const onBand = "focus-visible:bg-background focus-visible:ring-offset-2 focus-visible:ring-offset-background"

/** Application header with sidebar trigger, domain tag, product title, wordmark, and theme toggle. */
export function SiteHeader() {
  return (
    <header className="relative flex h-(--header-height) shrink-0 items-center gap-2 border-b border-border">
      <div className="flex w-full min-w-0 items-center gap-2 px-4 md:gap-3 md:px-6 xl:px-8">
        <SidebarTrigger className={`-ml-2 ${onBand}`} />
        {/* Written in sentence case: CSS sets the capitals, so a screen reader says "Ownership", not its letters. */}
        <span className="domain-tag domain-tag-ownership">Ownership</span>
        <span className="min-w-0 truncate font-heading text-base font-bold tracking-tight text-foreground">Service Scheduler</span>
        <div className="ml-auto flex shrink-0 items-center gap-1 max-sm:hidden">
          <span className="font-heading text-wordmark font-extrabold tracking-tight text-foreground">Keyloop</span>
          <ModeToggle variant="ghost" className={onBand} />
        </div>
      </div>
    </header>
  )
}
