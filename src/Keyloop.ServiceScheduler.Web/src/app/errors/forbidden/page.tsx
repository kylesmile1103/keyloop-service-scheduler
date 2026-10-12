// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/errors/forbidden/components/forbidden-error.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { DispatchBoardLink, ErrorPage } from "../components/error-page"

/** 403 (`/errors/forbidden`): the signed-in account's role does not include the page. */
export default function ForbiddenPage() {
  return (
    <ErrorPage title="No access to this page" illustration="forbidden" action={<DispatchBoardLink />}>
      <p>Your role does not include this page. An administrator can give your account access.</p>
    </ErrorPage>
  )
}
