// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/errors/*/components/*-error.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import type { LucideIcon } from "lucide-react"
import { CalendarRange } from "lucide-react"
import type { ReactNode } from "react"
import { Link } from "react-router-dom"

import { IllustratedState } from "@/components/illustrated-state"
import { BaseLayout } from "@/components/layouts/base-layout"
import { buttonVariants } from "@/components/ui/button"
import type { Illustration } from "@/lib/illustrations"

interface ErrorPageProps {
  /** The headline, which is also the browser tab's title. */
  title: string
  illustration: Illustration
  /** An icon tile over the illustration's corner (a key for sign-in, a lock for no access). */
  badge?: LucideIcon
  /** One or two lines: what happened, and what to do. */
  children: ReactNode
  /** The page's one action. */
  action: ReactNode
}

/**
 * An error page in the app's frame (UI_DESIGN 12.1, the not-found page's layout): the sidebar and header stay, so every
 * page is still a click away, and the work surface holds the illustrated state with the headline as the page's `h1` and
 * one action. The template's placeholder image, numeric headline, "Go Back Home" and "Contact Us" are not kept.
 */
export function ErrorPage({ title, illustration, badge: Badge, children, action }: ErrorPageProps) {
  return (
    <BaseLayout documentTitle={title}>
      <div className="flex min-h-[60svh] flex-1 items-center justify-center px-4 md:px-6 xl:px-8">
        <IllustratedState
          illustration={illustration}
          level={1}
          title={title}
          badge={
            Badge && (
              <span className="flex size-11 items-center justify-center rounded-chip bg-card text-foreground shadow-md ring-1 ring-foreground/10 md:size-12">
                <Badge className="size-5 md:size-6" />
              </span>
            )
          }
          action={action}
        >
          {children}
        </IllustratedState>
      </div>
    </BaseLayout>
  )
}

/** The way back from any error page: the dispatch board, the app's home. */
export function DispatchBoardLink({ variant = "default" }: { variant?: "default" | "outline" }) {
  return (
    <Link to="/dispatch" className={buttonVariants({ variant })}>
      <CalendarRange aria-hidden="true" />
      Go to the dispatch board
    </Link>
  )
}
