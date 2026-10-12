// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/errors/forbidden/components/forbidden-error.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { useCurrentUser } from "@/hooks/use-current-user"
import { nameOf } from "@/lib/session"

import { DispatchBoardLink, ErrorPage } from "../components/error-page"

/**
 * 403 (`/errors/forbidden`), also shown in place by the Resources area to an account without a role: the signed-in
 * account's role does not include the page, and roles come from the workshop administrator.
 */
export default function ForbiddenPage() {
  const { user } = useCurrentUser()
  return (
    <ErrorPage title="No access to this page" illustration="forbidden" action={<DispatchBoardLink />}>
      <p>
        {user?.authenticated ? `You are signed in as ${nameOf(user)}, but your account’s role` : "Your account’s role"} does
        not include this page.
      </p>
      <p>Roles (Admin, Service advisor, Viewer) are assigned by the workshop administrator: ask them for access.</p>
    </ErrorPage>
  )
}
