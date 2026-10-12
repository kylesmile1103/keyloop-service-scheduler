import { useHref, useLocation } from "react-router-dom"

import { useCurrentUser } from "@/hooks/use-current-user"
import { type IdentitySource, signInHref } from "@/lib/session"

/** Settings > Account, which says who is signed in and, on the development server, how to change the configured identity. */
export const ACCOUNT_PATH = "/settings/account"

/** The local page to come back to after signing in: the current path and search, with the router's base. */
export function useReturnTo(): string {
  const { pathname, search } = useLocation()
  return useHref({ pathname, search })
}

/**
 * Where a Sign in action leads. With Cloudflare Access it is the API's login URL (a top-level navigation; the login page
 * is never requested by script), returning to `returnTo`, by default the current page. With the development server's
 * configured identity there is no login page, so it leads to Settings > Account, which explains how to change it, and says
 * so ("How to sign in").
 */
export type SignInTarget =
  | { source: Extract<IdentitySource, "access">; href: string; label: "Sign in" }
  | { source: Extract<IdentitySource, "configuration">; to: string; label: "How to sign in" }

export function useSignInTarget({ returnTo, loginUrl }: { returnTo?: string; loginUrl?: string } = {}): SignInTarget {
  const current = useCurrentUser()
  const here = useReturnTo()
  if (current.source === "configuration") return { source: "configuration", to: ACCOUNT_PATH, label: "How to sign in" }
  return { source: "access", href: signInHref(loginUrl ?? current.loginUrl, returnTo ?? here), label: "Sign in" }
}
