import { CircleAlert, RotateCw } from "lucide-react"

import { ProblemAlert } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import { authRefusalTitle, failureStatus } from "@/lib/problem-details"

import { preconditionMissing } from "../lib/admin-api"

/** An error under its field (11.4): `CircleAlert` and the sentence, named by the field's `aria-describedby`. */
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
  onRetry: () => void
  retrying: boolean
}

/**
 * A save the API refused for a reason other than a field or a conflict (UI_DESIGN 11.16): signed out or another role, in the
 * action's words; an edit sent without its version (`428`, the app's fault), with Reload; anything else with Try again.
 */
export function FailureAlert({ failure, action, onReload, onRetry, retrying }: FailureAlertProps) {
  const status = failureStatus(failure)
  if (preconditionMissing(failure)) {
    return (
      <ProblemAlert
        title="Couldn’t save: the change went without the version it was made from"
        error={failure}
        tone="warning"
        actions={
          onReload && (
            <Button type="button" variant="outline" size="sm" onClick={onReload} className="cursor-pointer text-foreground">
              <RotateCw aria-hidden="true" />
              Reload
            </Button>
          )
        }
      />
    )
  }
  if (status === 401 || status === 403) {
    return <ProblemAlert title={authRefusalTitle(status, action)} error={failure} tone="warning" />
  }
  return <ProblemAlert title="Couldn’t save" error={failure} onRetry={onRetry} retrying={retrying} tone={status && status < 500 ? "warning" : "error"} />
}
