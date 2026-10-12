// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/errors/unauthorized/components/unauthorized-error.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { LogIn } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { signInUrl } from "@/lib/session"

import { DispatchBoardLink, ErrorPage } from "../components/error-page"

/**
 * 401 (`/errors/unauthorized`): sign in to continue. Its action is Sign in, to the address the session gives (Task 27b
 * wires it to the Access login URL). Until the app offers sign-in the page says so and leads to the dispatch board.
 */
export default function UnauthorizedPage() {
  const signIn = signInUrl()
  return (
    <ErrorPage
      title="Sign in to continue"
      illustration="unauthorized"
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
      {!signIn && (
        <p>
          This app does not offer sign-in yet. Anyone may view the schedule, with customer details masked; booking and
          cancelling need a workshop account.
        </p>
      )}
    </ErrorPage>
  )
}
