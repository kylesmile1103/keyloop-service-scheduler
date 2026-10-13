import { useHref, useLocation } from "react-router-dom"

import { useCurrentUser } from "@/hooks/use-current-user"
import { type IdentitySource, signInHref } from "@/lib/session"

export const ACCOUNT_PATH = "/settings/account"

/** Current route path and search string formatted as a post-sign-in return URL. */
export function useReturnTo(): string {
  const { pathname, search } = useLocation()
  return useHref({ pathname, search })
}

/** Sign-in destination: Cloudflare Access login endpoint in production, or Settings > Account in dev mode. */
export type SignInTarget =
  | { source: Extract<IdentitySource, "access">; href: string; label: "Sign in" }
  | { source: Extract<IdentitySource, "configuration">; to: string; label: "How to sign in" }

export function useSignInTarget({ returnTo }: { returnTo?: string } = {}): SignInTarget {
  const current = useCurrentUser()
  const here = useReturnTo()
  if (current.source === "configuration") return { source: "configuration", to: ACCOUNT_PATH, label: "How to sign in" }
  return { source: "access", href: signInHref(returnTo ?? here), label: "Sign in" }
}
