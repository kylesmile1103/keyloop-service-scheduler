// Adopted from shadcn-dashboard-landing-template (vite-version) `src/components/router/root-layout.tsx` and, for the
// error boundary, `src/app/errors/internal-server-error/components/internal-server-error.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { RotateCw } from "lucide-react"
import { isRouteErrorResponse, Outlet, useNavigation, useRouteError } from "react-router-dom"

import { SessionRenewalProvider } from "@/components/auth/session-banner"
import { SessionWatch } from "@/components/auth/session-watch"
import { IllustratedState } from "@/components/illustrated-state"
import { TraceIdRow } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { LoadingSpinner } from "@/components/ui/loading-spinner"

/** Thin top bar shown while the next route's code is loading. */
function RouteProgress() {
  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      className="route-progress fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-primary/15"
    >
      <div className="route-progress-bar h-full w-1/3 bg-primary" />
    </div>
  )
}

export function RootLayout() {
  const navigation = useNavigation()
  return (
    // One session renewal for the tab, whose banner each page shows under its header (components/auth/session-banner).
    <SessionRenewalProvider>
      {navigation.state === "loading" && <RouteProgress />}
      <Outlet />
      {/* After the routes: its effects run after the pages' own (see SessionWatch). */}
      <SessionWatch />
    </SessionRenewalProvider>
  )
}

/** Shown on the very first load, before any route has rendered. */
export function RootFallback() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <LoadingSpinner />
    </div>
  )
}

/**
 * Shown when a page fails to load or render - most often a code chunk that no longer exists after a new deployment
 * (adopted from the template's `errors/internal-server-error`, in the UI_DESIGN 12.1 layout). Says what failed and
 * offers the one action that fixes it: reloading the route, which also fetches the latest version after an update.
 */
export function RootErrorBoundary() {
  const error = useRouteError()
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`.trim()
    : error instanceof Error
      ? error.message
      : "Unknown error"
  const traceId = typeof error === "object" && error !== null && "traceId" in error && typeof error.traceId === "string" ? error.traceId : null

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <title>Something went wrong – Keyloop Service Scheduler</title>
      <IllustratedState
        role="alert"
        illustration="error-connection"
        level={1}
        title="Something went wrong"
        action={
          <Button onClick={() => window.location.reload()}>
            <RotateCw aria-hidden="true" />
            Try again
          </Button>
        }
      >
        <p>This page could not be loaded. Trying again reloads it, with the latest version after an update.</p>
        <p className="font-mono text-xs break-all">{detail}</p>
        {traceId && <TraceIdRow traceId={traceId} className="max-w-full" />}
      </IllustratedState>
    </div>
  )
}
