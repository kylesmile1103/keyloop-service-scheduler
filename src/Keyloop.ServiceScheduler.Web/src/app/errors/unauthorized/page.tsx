// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/errors/unauthorized/components/unauthorized-error.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { useLocation } from "react-router-dom"

import { SignInAction } from "@/components/auth/sign-in-action"
import { DevelopmentIdentityNote } from "@/components/auth/development-identity-note"
import { useReturnTo } from "@/hooks/use-sign-in"
import { ERROR_PAGES } from "@/lib/error-pages"

import { ErrorPage } from "../components/error-page"
import { useErrorPageState } from "../components/use-error-page-state"

/**
 * 401 (`/errors/unauthorized`), also shown in place by the Resources area to a visitor who is not signed in: sign in to
 * continue. Its action is Sign in, to the API's Access login URL, coming back to the page that needed it: the address a
 * sending page passed, the page it is shown on in place, or the dispatch board when opened on its own.
 */
export default function UnauthorizedPage() {
  const { from } = useErrorPageState()
  const here = useReturnTo()
  const onItsOwnRoute = useLocation().pathname === ERROR_PAGES.unauthorized
  const returnTo = from ?? (onItsOwnRoute ? "/dispatch" : here)

  return (
    <ErrorPage title="Sign in to continue" illustration="unauthorized" action={<SignInAction returnTo={returnTo} />}>
      <p>This page needs you to be signed in with a workshop account.</p>
      <p>Anyone can view the board, with customer details masked; booking, cancelling and the Resources area need an account.</p>
      <DevelopmentIdentityNote />
    </ErrorPage>
  )
}
