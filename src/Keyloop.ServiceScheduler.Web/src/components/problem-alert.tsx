import { CircleX, Clock, RotateCw, TriangleAlert } from "lucide-react"
import type { ReactNode, Ref } from "react"

import { CopyButton } from "@/components/copy-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { describeFailure, failureKey } from "@/lib/problem-details"
import { cn } from "@/lib/utils"

export type ProblemTone = "error" | "warning" | "info"

interface ProblemAlertProps {
  /** What failed, in the page's words: "Couldn’t load dealerships". */
  title: string
  /** The error from the generated client (a problem body, or a failure without one). */
  error: unknown
  onRetry?: () => void
  /** True while the retry is in flight. */
  retrying?: boolean
  /** Keeps the retry action disabled (a rate limit's wait, an account that may not make the request). */
  retryDisabled?: boolean
  /** The id of what says why the retry is unavailable, read with it (`aria-describedby`). */
  retryDescribedBy?: string
  /** `error` for load/save failures, `warning` for business-rule/conflict refusals (409/422), or `info` for rate limits. */
  tone?: ProblemTone
  /** Additional problem content such as suggested slots or missing requirements. */
  children?: ReactNode
  /** Actions rendered next to or in place of the retry button. */
  actions?: ReactNode
  /** Makes the alert programmatically focusable (`tabIndex={-1}`) when the triggering control unmounts. */
  focusRef?: Ref<HTMLDivElement>
  className?: string
}

const tones: Record<ProblemTone, { icon: typeof CircleX; alert: string; title: string; detail: string }> = {
  error: { icon: CircleX, alert: "bg-card text-destructive", title: "", detail: "" },
  warning: {
    icon: TriangleAlert,
    alert: "border-warning/30 bg-warning-subtle text-foreground *:[svg]:text-warning",
    title: "text-warning",
    detail: "text-foreground",
  },
  info: {
    icon: Clock,
    alert: "border-info/30 bg-info-subtle text-foreground *:[svg]:text-info",
    title: "text-info",
    detail: "text-foreground",
  },
}

/** Inline alert displaying an API failure summary, trace ID with copy action, and optional retry button. */
export function ProblemAlert({
  title,
  error,
  onRetry,
  retrying = false,
  retryDisabled = false,
  retryDescribedBy,
  tone = "error",
  children,
  actions,
  focusRef,
  className,
}: ProblemAlertProps) {
  const { summary, traceId } = describeFailure(error)
  const { icon: Icon, alert, title: titleClass, detail } = tones[tone]

  return (
    <Alert
      ref={focusRef}
      tabIndex={focusRef ? -1 : undefined}
      variant={tone === "error" ? "destructive" : "default"}
      data-tone={tone}
      className={cn("px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50", alert, className)}
    >
      <Icon aria-hidden="true" />
      <AlertTitle className={cn("font-semibold wrap-break-word", titleClass)}>{title}</AlertTitle>
      <AlertDescription className={cn("flex flex-col gap-2", detail)}>
        {/* Keyed by failure instance so repeated identical errors are re-announced by screen readers. */}
        <span key={failureKey(error)} className="wrap-break-word">
          {summary}
        </span>
        {traceId && <TraceIdRow traceId={traceId} />}
        {children}
        {(onRetry || actions) && (
          <span className="flex flex-wrap items-center gap-2 pt-1">
            {onRetry && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRetry}
                disabled={retrying || retryDisabled}
                focusableWhenDisabled
                aria-describedby={retryDescribedBy}
                className="text-foreground"
              >
                <RotateCw aria-hidden="true" className={cn(retrying && "animate-spin")} />
                Try again
              </Button>
            )}
            {actions}
          </span>
        )}
      </AlertDescription>
    </Alert>
  )
}

/** Trace ID row with truncated monospace value and copy button. */
export function TraceIdRow({ traceId, className }: { traceId: string; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <span className="shrink-0 text-xs text-muted-foreground">Trace ID</span>
      <code className="truncate font-mono text-xs tracking-wide text-foreground/80" title={traceId}>
        {traceId}
      </code>
      <CopyButton value={traceId} label="Copy trace ID" copiedLabel="Trace ID copied" />
    </span>
  )
}
