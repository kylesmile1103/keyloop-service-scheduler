import { Refine } from "@refinedev/core"
import { LoaderCircle } from "lucide-react"
import routerProvider from "@refinedev/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { useMemo } from "react"
import { Outlet } from "react-router-dom"

import ForbiddenPage from "@/app/errors/forbidden/page"
import UnauthorizedPage from "@/app/errors/unauthorized/page"
import { FailedState } from "@/components/failed-state"
import { BaseLayout } from "@/components/layouts/base-layout"
import { useCurrentUser } from "@/hooks/use-current-user"

import { createSchedulerDataProvider } from "./lib/data-provider"
import { RESOURCES, refineOptions } from "./lib/refine"

/**
 * The admin area's route element. The area needs a signed-in user with a role (ADR-027, ARCHITECTURE §15): until `/me`
 * answers it says it is checking; a visitor who is not signed in gets the 401 page in place (Sign in comes back to this
 * address), an account without a role the 403 page; a Viewer, Service advisor or Admin sees the read-only lists (Task 30
 * adds Admin-only editing). Refine is mounted only then, so nothing of the area is read for anyone else.
 */
export default function AdminLayout() {
  const current = useCurrentUser()

  if (current.status === "loading") {
    return (
      <BaseLayout documentTitle="Resources">
        <div role="status" className="flex min-h-[60svh] flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-6 animate-spin motion-reduce:animate-none" />
          Checking who is signed in…
        </div>
      </BaseLayout>
    )
  }
  if (current.status === "failed") {
    return (
      <BaseLayout documentTitle="Resources">
        <div className="flex min-h-[60svh] flex-1 items-center justify-center px-4">
          <FailedState title="Couldn’t check who is signed in" error={current.error} onRetry={current.refetch} retrying={current.fetching} />
        </div>
      </BaseLayout>
    )
  }
  if (!current.authenticated) return <UnauthorizedPage />
  if (!current.canOpenResources) return <ForbiddenPage />
  return <ResourcesArea />
}

/**
 * Refine core, headless, around the resources pages (ARCHITECTURE §15, ADR-031). It is mounted for this route subtree
 * only, and the subtree is its own code-split chunk, so the dispatch board, calendar and overview never load Refine; they
 * keep their generated query hooks. Refine shares the app's QueryClient, follows the address through its React Router
 * binding and reads through the read-only data provider over the generated client.
 */
function ResourcesArea() {
  const queryClient = useQueryClient()
  const dataProvider = useMemo(() => createSchedulerDataProvider(queryClient), [queryClient])
  const options = useMemo(() => refineOptions(queryClient), [queryClient])

  return (
    <Refine dataProvider={dataProvider} routerProvider={routerProvider} resources={RESOURCES} options={options}>
      <Outlet />
    </Refine>
  )
}
