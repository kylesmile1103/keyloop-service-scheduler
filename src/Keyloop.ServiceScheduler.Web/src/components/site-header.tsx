"use client"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { ModeToggle } from "@/components/mode-toggle"

/**
 * Ghost buttons over the header band: when focused they take the work surface's colour and offset their ring, so the 1 px
 * focus border has the background on both sides (3.9:1 light) instead of the band's lavender (2.4:1). DESIGN_SYSTEM 12.3.
 */
const onBand = "focus-visible:bg-background focus-visible:ring-offset-2 focus-visible:ring-offset-background"

/**
 * The product's header (DESIGN_SYSTEM 11.1): the sidebar trigger, the OWNERSHIP domain tag (Keyloop Fusion's aftersales
 * and service domain, this app's signature), the product title, then the "Keyloop" wordmark as plain text (never a link,
 * never a logo image) and the theme toggle. Below 640 px the wordmark moves into the mobile sidebar and the theme choice
 * into its footer, so the title has room.
 */
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
