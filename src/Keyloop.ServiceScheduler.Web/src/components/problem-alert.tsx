import { CircleAlert, RotateCw, TriangleAlert } from "lucide-react"

import { CopyButton } from "@/components/copy-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { describeFailure } from "@/lib/problem-details"
import { cn } from "@/lib/utils"

interface ProblemAlertProps {
  /** What failed, in the page's words: "Couldn’t load dealerships". */
  title: string
  /** The error from the generated client (a problem body, or a failure without one). */
  error: unknown
  onRetry?: () => void
  /** True while the retry is in flight. */
  retrying?: boolean
  /**
   * `error` (the default) for a failure to load or save; `warning` for a refusal that reflects the current state, such as a
   * `409` conflict: the request was understood, and the screen should be read again rather than retried.
   */
  tone?: "error" | "warning"
  className?: string
}

/**
 * A failed API call: what failed, the API's explanation, and its trace id (to look the request up in the Aspire dashboard,
 * §12.2), with a retry when one makes sense. It fits any width: the text wraps, the trace id is cut short (its full value is
 * in its tooltip and the copy button), so the copy button never leaves the screen.
 */
export function ProblemAlert({ title, error, onRetry, retrying = false, tone = "error", className }: ProblemAlertProps) {
  const { summary, traceId } = describeFailure(error)
  const Icon = tone === "warning" ? TriangleAlert : CircleAlert

  return (
    <Alert
      variant={tone === "warning" ? "default" : "destructive"}
      data-tone={tone}
      className={cn("bg-card px-4 py-3", tone === "warning" && "border-warning/60", className)}
    >
      <Icon aria-hidden="true" />
      <AlertTitle className="wrap-break-word">{title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span className="wrap-break-word">{summary}</span>
        {traceId && (
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <span className="shrink-0 text-xs">Trace ID</span>
            <code className="truncate font-mono text-xs text-foreground/80" title={traceId}>
              {traceId}
            </code>
            <CopyButton value={traceId} label="Copy trace ID" copiedLabel="Trace ID copied" />
          </span>
        )}
        {onRetry && (
          <span className="pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetry}
              disabled={retrying}
              className="text-foreground pointer-coarse:h-11"
            >
              <RotateCw aria-hidden="true" className={cn(retrying && "animate-spin")} />
              Try again
            </Button>
          </span>
        )}
      </AlertDescription>
    </Alert>
  )
}
