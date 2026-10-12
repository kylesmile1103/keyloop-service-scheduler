// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/errors/not-found/components/not-found-error.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { useLocation } from "react-router-dom"

import { DispatchBoardLink, ErrorPage } from "../components/error-page"

/** The router's 404 (`*`, and `/errors/not-found` to navigate to): nothing lives at the address. */
export default function NotFoundPage() {
  const { pathname } = useLocation()

  return (
    <ErrorPage title="Page not found" illustration="empty-schedule" action={<DispatchBoardLink />}>
      <p>
        Nothing lives at <code className="font-mono text-[0.9em] break-all text-foreground">{pathname}</code>.
      </p>
    </ErrorPage>
  )
}
