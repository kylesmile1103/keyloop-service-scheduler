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

/** Route guard and layout for the Resources area, requiring an authenticated user with an assigned role. */
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

/** Headless Refine provider scoped to the resources route subtree. */
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
