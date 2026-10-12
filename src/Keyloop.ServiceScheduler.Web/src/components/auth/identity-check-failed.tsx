import { RotateCw, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useCurrentUser } from "@/hooks/use-current-user"
import { cn } from "@/lib/utils"

/** What a prompt that asks to sign in says while `/me` cannot be read. */
export const IDENTITY_CHECK_FAILED = "Couldn’t check who is signed in, so the app treats you as signed out."

/**
 * Inside a sign-in prompt, only while `/me` cannot be read: that the check failed (so nobody is known and the prompt asks
 * to sign in), with Try again, which reads `/me` again (unavailable but focusable while it does).
 */
export function IdentityCheckFailed({ className }: { className?: string }) {
  const current = useCurrentUser()
  if (current.status !== "failed") return null
  return (
    <div className={cn("flex flex-col items-start gap-2 text-sm text-pretty", className)}>
      <p className="flex items-start gap-2 text-left">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
        <span>{IDENTITY_CHECK_FAILED}</span>
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={current.refetch}
        disabled={current.fetching}
        focusableWhenDisabled
        className="pointer-coarse:h-11"
      >
        <RotateCw aria-hidden="true" className={cn(current.fetching && "animate-spin")} />
        Try again
      </Button>
    </div>
  )
}
