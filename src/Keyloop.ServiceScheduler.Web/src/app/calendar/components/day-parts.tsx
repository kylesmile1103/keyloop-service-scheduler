// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/calendar/components/calendar-main.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { Plus } from "lucide-react"
import type { ReactNode } from "react"
import { Link } from "react-router-dom"

import type { BookState } from "@/app/dispatch/hooks/use-book-action"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { DATE_PARAM, DEALERSHIP_PARAM } from "@/lib/workshop-params"

import { dayInWords } from "../lib/calendar"

/** Icon button for starting a new appointment on a specific day. */
export function NewOnDay({ date, onNew, bookState }: { date: string; onNew: (date: string) => void; bookState: BookState }) {
  const label = `New appointment on ${dayInWords(date)}`
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            onClick={() => onNew(date)}
            className="size-7 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
            {...bookState}
          />
        }
      >
        <Plus aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

interface DayLinkProps {
  date: string
  today: string
  dealershipId: string
  children: ReactNode
  className?: string
}

/** Day header link navigating to that date's dispatch board. */
export function DayLink({ date, today, dealershipId, children, className }: DayLinkProps) {
  const search = new URLSearchParams({ [DEALERSHIP_PARAM]: dealershipId })
  if (date !== today) search.set(DATE_PARAM, date)
  return (
    <Link
      to={{ pathname: "/dispatch", search: `?${search}` }}
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11",
        className
      )}
    >
      <span aria-hidden="true" className="contents">
        {children}
      </span>
      <span className="sr-only">{`${dayInWords(date)}${date === today ? ", today" : ""}, dispatch board`}</span>
    </Link>
  )
}

/** Day-of-month badge, highlighted when `date` is today. */
export function DayNumber({ date, today, muted = false }: { date: string; today: string; muted?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full font-heading text-sm font-semibold tabular-nums",
        date === today ? "bg-primary text-primary-foreground" : muted ? "text-muted-foreground" : "text-foreground"
      )}
    >
      {Number(date.slice(8))}
    </span>
  )
}
