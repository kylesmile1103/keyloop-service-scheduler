import { cn } from "@/lib/utils"

/** Decorative miniature of the dispatch board styled with the specified theme's tokens. */
export function ThemePreview({ theme, className }: { theme: "light" | "dark"; className?: string }) {
  return (
    <div aria-hidden="true" className={cn(theme, "flex h-full w-full gap-1.5 bg-sidebar p-1.5", className)}>
      <div className="flex w-1/5 flex-col gap-1 pt-1">
        <span className="h-1.5 w-4/5 rounded-full bg-sidebar-accent" />
        <span className="h-1.5 w-3/5 rounded-full bg-border" />
        <span className="h-1.5 w-4/6 rounded-full bg-border" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-md bg-background p-1.5 shadow-xs ring-1 ring-foreground/10">
        <div className="flex items-center justify-between gap-1">
          <span className="h-1.5 w-2/5 rounded-full bg-foreground/70" />
          <span className="h-2.5 w-1/5 rounded-sm bg-primary" />
        </div>
        <div className="grid grid-cols-4 gap-1">
          {[0, 1, 2, 3].map((index) => (
            <span key={index} className="h-3.5 rounded-sm bg-card ring-1 ring-foreground/10" />
          ))}
        </div>
        <div className="flex flex-1 flex-col justify-around gap-1 rounded-sm bg-card p-1 ring-1 ring-foreground/10">
          <span className="flex gap-1">
            <span className="h-2 w-1/3 rounded-sm border-l-2 border-status-confirmed-border bg-status-confirmed-bg" />
            <span className="ml-auto h-2 w-1/4 rounded-sm border-l-2 border-status-in-progress-border bg-status-in-progress-bg" />
          </span>
          <span className="flex gap-1">
            <span className="ml-[15%] h-2 w-2/5 rounded-sm border-l-2 border-status-checked-in-border bg-status-checked-in-bg" />
          </span>
          <span className="flex gap-1">
            <span className="h-2 w-1/4 rounded-sm border-l-2 border-status-completed-border bg-status-completed-bg" />
            <span className="h-2 w-1/3 rounded-sm border-l-2 border-status-confirmed-border bg-status-confirmed-bg" />
          </span>
        </div>
      </div>
    </div>
  )
}
