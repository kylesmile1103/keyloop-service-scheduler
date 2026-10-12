import { GitCompareArrows } from "lucide-react"
import { type ReactNode, type Ref, useId } from "react"

import { cn } from "@/lib/utils"

import type { ConflictRow } from "../lib/changes"

interface ConflictPanelProps {
  ref?: Ref<HTMLElement>
  /** "Someone else changed Ben Okafor". */
  title: string
  /** One or two sentences: what happened and what the choices do. */
  children: ReactNode
  rows: readonly ConflictRow[]
  /** The choices: Reapply my changes, Discard my changes (or the action's own words); none inside a dialog that has its own. */
  actions: ReactNode
  /** Whether to show this Admin's own values (off where the action changed nothing of the record yet, a confirmation). */
  showYours?: boolean
  className?: string
}

/**
 * A `412 precondition-failed` (UI_DESIGN 11.24): another Admin saved first. In the warning treatment, a region named by
 * its title, focusable so focus can move to it (the Save that was pressed is no longer the next step), with the fields that
 * differ as a table: the field, as it was when the form was opened, as it is now, and as this Admin had it ("No change"
 * when this Admin left it). Below 640 px each row stacks its three values under the field's name; the explicit table roles
 * keep it a table to assistive technology when CSS changes its display.
 */
export function ConflictPanel({ ref, title, children, rows, actions, showYours = true, className }: ConflictPanelProps) {
  const headingId = useId()
  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby={headingId}
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning-subtle p-3 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-4",
        className
      )}
    >
      <div className="flex items-start gap-2.5">
        <GitCompareArrows aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="flex min-w-0 flex-col gap-1 text-pretty">
          <h3 id={headingId} className="font-semibold text-warning">
            {title}
          </h3>
          <div className="flex flex-col gap-1">{children}</div>
        </div>
      </div>
      {rows.length > 0 && (
        <table role="table" className="w-full border-collapse overflow-hidden rounded-lg bg-card text-left text-sm ring-1 ring-border max-sm:block">
          <caption className="sr-only">What changed</caption>
          <thead className="bg-muted/50 text-xs text-muted-foreground max-sm:sr-only">
            <tr role="row">
              <th scope="col" role="columnheader" className="px-3 py-2 font-medium">
                Field
              </th>
              <th scope="col" role="columnheader" className="px-3 py-2 font-medium">
                When you opened it
              </th>
              <th scope="col" role="columnheader" className="px-3 py-2 font-medium">
                Now
              </th>
              {showYours && (
                <th scope="col" role="columnheader" className="px-3 py-2 font-medium">
                  Yours
                </th>
              )}
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {rows.map((row) => (
              <tr key={row.key} role="row" className="border-t border-border align-top first:border-t-0 max-sm:grid max-sm:grid-cols-[6.5rem_minmax(0,1fr)] max-sm:gap-x-3 max-sm:gap-y-0.5 max-sm:px-3 max-sm:py-2.5">
                <th scope="row" role="rowheader" className="px-3 py-2 font-medium max-sm:col-span-2 max-sm:p-0">
                  {row.label}
                </th>
                <Cell label="When you opened it" className="text-muted-foreground">
                  {row.opened}
                </Cell>
                <Cell label="Now" className="font-medium">
                  {row.now}
                </Cell>
                {showYours && (
                  <Cell label="Yours" className={row.yours === null ? "text-muted-foreground" : "font-medium text-signal"}>
                    {row.yours ?? "No change"}
                  </Cell>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </section>
  )
}

/** A value cell; below 640 px its column's name goes before it, the header row being visually hidden there. */
function Cell({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <td role="cell" className={cn("px-3 py-2 wrap-break-word max-sm:contents", className)}>
      <span aria-hidden="true" className="hidden text-xs font-normal text-muted-foreground max-sm:block">
        {label}
      </span>
      <span className="max-sm:block">{children}</span>
    </td>
  )
}
