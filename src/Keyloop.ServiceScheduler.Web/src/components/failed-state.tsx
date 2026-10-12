import { RotateCw } from "lucide-react"

import { IllustratedState } from "@/components/illustrated-state"
import { TraceIdRow } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { describeFailure, failureKey } from "@/lib/problem-details"
import { cn } from "@/lib/utils"

interface FailedStateProps {
  title: string
  error: unknown
  onRetry: () => void
  retrying: boolean
  /** The headline's level in the page outline (UI_DESIGN 12.1): 2 for a page's main view, 3 inside a card under its own heading. */
  level?: 2 | 3
}

/**
 * A whole view that failed to load (UI_DESIGN 12.1): the error-connection state with the API's words and trace id. It
 * stays while Try again reads again; the button disables itself meanwhile but keeps focus, ready for another try if that
 * one fails too.
 */
export function FailedState({ title, error, onRetry, retrying, level = 2 }: FailedStateProps) {
  const { summary, traceId } = describeFailure(error)
  return (
    <IllustratedState
      role="alert"
      illustration="error-connection"
      level={level}
      title={title}
      action={
        <Button type="button" onClick={onRetry} disabled={retrying} focusableWhenDisabled>
          <RotateCw aria-hidden="true" className={cn(retrying && "animate-spin")} />
          Try again
        </Button>
      }
      className="px-4"
    >
      <p key={failureKey(error)} className="wrap-break-word">
        {summary}
      </p>
      {traceId && <TraceIdRow traceId={traceId} className="max-w-full" />}
    </IllustratedState>
  )
}
