import { KeyRound, LogIn } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { signInUrl } from "@/lib/session"

import { DispatchBoardLink, ErrorPage } from "../components/error-page"

/**
 * 401 (`/errors/unauthorized`): sign in to continue. Its action is Sign in, to the address the session gives (Task 27b
 * wires it to the Access login URL). While sign-in is not enabled the page says so and leads to the dispatch board.
 */
export default function UnauthorizedPage() {
  const signIn = signInUrl()
  return (
    <ErrorPage
      title="Sign in to continue"
      illustration="closed-day"
      badge={KeyRound}
      action={
        signIn ? (
          <a href={signIn} className={buttonVariants()}>
            <LogIn aria-hidden="true" />
            Sign in
          </a>
        ) : (
          <DispatchBoardLink />
        )
      }
    >
      <p>This page needs you to be signed in.</p>
      {!signIn && <p>Sign-in is not enabled in this environment, so every page is open without it.</p>}
    </ErrorPage>
  )
}
