import { CircleAlert, RotateCw } from "lucide-react"

import { ProblemAlert } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import { authRefusalTitle, failureStatus } from "@/lib/problem-details"
import { cn } from "@/lib/utils"

import { preconditionMissing } from "../lib/admin-api"

/** Field validation error message with alert icon. */
export function FieldMessage({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null
  return (
    <FieldError id={id} className="flex items-start gap-1.5">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </FieldError>
  )
}

interface FailureAlertProps {
  failure: unknown
  /** The action in words, for a 401 or 403's title: "save Ben Okafor". */
  action: string
  onReload?: () => void
  /** Reload's read is under way. */
  reloading?: boolean
  /** Reload's read failed: the alert stays, saying so, for another try. */
  reloadFailed?: boolean
  onRetry: () => void
  retrying: boolean
}

/** Alert for non-field save failures (401/403 auth refusal, 428 missing precondition, or general error). */
export function FailureAlert({ failure, action, onReload, reloading = false, reloadFailed = false, onRetry, retrying }: FailureAlertProps) {
  const status = failureStatus(failure)
  if (preconditionMissing(failure)) {
    return (
      <ProblemAlert
        title="Couldn’t save: the change went without the version it was made from"
        error={failure}
        tone="warning"
        actions={
          onReload && (
            <Button type="button" variant="outline" size="sm" onClick={onReload} disabled={reloading} focusableWhenDisabled className="cursor-pointer text-foreground">
              <RotateCw aria-hidden="true" className={cn(reloading && "animate-spin motion-reduce:animate-none")} />
              Reload
            </Button>
          )
        }
      >
        <p>Reload reads it again and keeps what you entered.</p>
        {reloadFailed && <p className="font-medium">Couldn’t read it again. Check the connection, then reload once more.</p>}
      </ProblemAlert>
    )
  }
  if (status === 401 || status === 403) {
    return <ProblemAlert title={authRefusalTitle(status, action)} error={failure} tone="warning" />
  }
  return <ProblemAlert title="Couldn’t save" error={failure} onRetry={onRetry} retrying={retrying} tone={status && status < 500 ? "warning" : "error"} />
}
