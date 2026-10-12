import { useCurrentUser } from "@/hooks/use-current-user"
import { cn } from "@/lib/utils"

/** On the development server only: why Sign in leads to an explanation, not a login page. */
export function DevelopmentIdentityNote({ className }: { className?: string }) {
  const { source } = useCurrentUser()
  if (source !== "configuration") return null
  return (
    <p className={cn("max-w-xs text-xs text-pretty text-muted-foreground", className)}>
      On this development server the API&apos;s configuration decides who you are, so there is no sign-in page.
    </p>
  )
}
