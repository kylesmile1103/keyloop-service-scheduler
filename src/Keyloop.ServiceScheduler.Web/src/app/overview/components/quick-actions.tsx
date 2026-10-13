// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/dashboard-2/components/quick-actions.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { ChevronRight, Plus } from "lucide-react"
import { Link, type To } from "react-router-dom"

import type { BookState } from "@/app/dispatch/hooks/use-book-action"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface QuickActionsProps {
  board: To
  onBook: () => void
  bookState: BookState
  stacked: boolean
}

/** Quick action controls for booking an appointment and opening the dispatch board. */
export function QuickActions({ board, onBook, bookState, stacked }: QuickActionsProps) {
  return (
    <div role="group" aria-label="Quick actions" className={cn("flex items-center gap-2", stacked && "flex-col items-stretch")}>
      <Link to={board} className={cn(buttonVariants({ variant: "signal" }), "group/button pointer-coarse:h-11", stacked && "h-11")}>
        Open dispatch board
        <ChevronRight aria-hidden="true" className="transition-transform duration-150 group-hover/button:translate-x-0.5" />
      </Link>
      <Button type="button" onClick={onBook} className={cn("cursor-pointer pointer-coarse:h-11", stacked && "h-11")} {...bookState}>
        <Plus aria-hidden="true" />
        Book appointment
      </Button>
    </div>
  )
}
