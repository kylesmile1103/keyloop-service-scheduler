// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/errors/*/components/*-error.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { CalendarRange } from "lucide-react"
import type { ReactNode } from "react"
import { Link } from "react-router-dom"

import { IllustratedState } from "@/components/illustrated-state"
import { BaseLayout } from "@/components/layouts/base-layout"
import { buttonVariants } from "@/components/ui/button"
import type { Illustration } from "@/lib/illustrations"

interface ErrorPageProps {
  title: string
  illustration: Illustration
  children: ReactNode
  action: ReactNode
}

/** Shared layout for status error pages within the application shell. */
export function ErrorPage({ title, illustration, children, action }: ErrorPageProps) {
  return (
    <BaseLayout documentTitle={title}>
      <div className="flex min-h-[60svh] flex-1 items-center justify-center px-4 md:px-6 xl:px-8">
        <IllustratedState illustration={illustration} described level={1} title={title} action={action}>
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
