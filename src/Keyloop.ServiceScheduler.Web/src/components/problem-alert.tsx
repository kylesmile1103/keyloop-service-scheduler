import { CircleX, Clock, RotateCw, TriangleAlert } from "lucide-react"
import type { ReactNode } from "react"

import { CopyButton } from "@/components/copy-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { describeFailure } from "@/lib/problem-details"
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
  /** Keeps the retry action disabled (a rate limit's wait). */
  retryDisabled?: boolean
  /**
   * `error` (the default) for a failure to load or save; `warning` for a refusal that reflects the current state or a
   * business rule, such as a `409` conflict or a `422`: the request was understood, and the screen should be read again
   * or the request changed rather than retried; `info` for a rate limit, which passes on its own (DESIGN_SYSTEM 11.16).
   */
  tone?: ProblemTone
  /** What the problem offers beyond its summary: suggested slots, missing requirements. */
  children?: ReactNode
  /** Actions in place of, or next to, the retry. */
  actions?: ReactNode
  className?: string
}

const tones: Record<ProblemTone, { icon: typeof CircleX; alert: string; title: string; detail: string }> = {
  // A failure: the traffic light's cross on the card, in the destructive ink.
  error: { icon: CircleX, alert: "bg-card text-destructive", title: "", detail: "" },
  // A refusal: the warning banner, its triangle and title in the warning ink, the detail in the body colour.
  warning: {
    icon: TriangleAlert,
    alert: "border-warning/30 bg-warning-subtle text-foreground *:[svg]:text-warning",
    title: "text-warning",
    detail: "text-foreground",
  },
  // A rate limit: the info banner with a clock.
  info: {
    icon: Clock,
    alert: "border-info/30 bg-info-subtle text-foreground *:[svg]:text-info",
    title: "text-info",
    detail: "text-foreground",
  },
}

/**
 * A failed API call: what failed, the API's explanation, and its trace id (to look the request up in the Aspire dashboard,
 * §12.2), with a retry when one makes sense. It fits any width: the text wraps, the trace id is cut short (its full value is
 * in its tooltip and the copy button), so the copy button never leaves the screen.
 */
export function ProblemAlert({
  title,
  error,
  onRetry,
  retrying = false,
  retryDisabled = false,
  tone = "error",
  children,
  actions,
  className,
}: ProblemAlertProps) {
  const { summary, traceId } = describeFailure(error)
  const { icon: Icon, alert, title: titleClass, detail } = tones[tone]

  return (
    <Alert variant={tone === "error" ? "destructive" : "default"} data-tone={tone} className={cn("px-4 py-3", alert, className)}>
      <Icon aria-hidden="true" />
      <AlertTitle className={cn("font-semibold wrap-break-word", titleClass)}>{title}</AlertTitle>
      <AlertDescription className={cn("flex flex-col gap-2", detail)}>
        <span className="wrap-break-word">{summary}</span>
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

/** "Trace ID", the id in mono (cut short to fit, whole in its tooltip) and a copy button (DESIGN_SYSTEM 11.8). */
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
