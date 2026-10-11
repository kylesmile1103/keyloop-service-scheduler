import { RotateCw, TriangleAlert } from "lucide-react"
import { isRouteErrorResponse, Outlet, useNavigation, useRouteError } from "react-router-dom"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
    <>
      {navigation.state === "loading" && <RouteProgress />}
      <Outlet />
    </>
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
 * Shown when a page fails to load or render - most often a code chunk that no longer exists after a new deployment.
 * Says what failed and offers the one action that fixes it.
 */
export function RootErrorBoundary() {
  const error = useRouteError()
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`.trim()
    : error instanceof Error
      ? error.message
      : "Unknown error"

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <title>Page failed to load – Keyloop Service Scheduler</title>
      <Alert variant="destructive" className="max-w-lg">
        <TriangleAlert />
        <AlertTitle>This page could not be loaded</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <p className="font-mono text-xs break-all">{detail}</p>
          <p>Reload to try again. After an update, reloading also fetches the latest version.</p>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            <RotateCw />
            Reload the page
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  )
}
