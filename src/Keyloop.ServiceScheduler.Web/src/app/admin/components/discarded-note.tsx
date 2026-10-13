import { Info } from "lucide-react"
import type { ReactNode } from "react"

/** The note that an open edit was closed because who is signed in changed (`role="status"`, so it is read out). */
export function DiscardedNote({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-start gap-2 rounded-lg bg-info-subtle px-3 py-2 text-sm text-pretty text-foreground">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
      <span>{children}</span>
    </p>
  )
}
