import { Refine } from "@refinedev/core"
import routerProvider from "@refinedev/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { useMemo } from "react"
import { Outlet } from "react-router-dom"

import { createSchedulerDataProvider } from "./lib/data-provider"
import { RESOURCES, refineOptions } from "./lib/refine"

/**
 * The admin area's route element: Refine core, headless, around the resources pages (ARCHITECTURE §15, ADR-031). It is
 * mounted for this route subtree only, and the subtree is its own code-split chunk, so the dispatch board, calendar and
 * overview never load Refine; they keep their generated query hooks. Refine shares the app's QueryClient, follows the
 * address through its React Router binding and reads through the read-only data provider over the generated client.
 */
export default function AdminLayout() {
  const queryClient = useQueryClient()
  const dataProvider = useMemo(() => createSchedulerDataProvider(queryClient), [queryClient])
  const options = useMemo(() => refineOptions(queryClient), [queryClient])

  return (
    <Refine dataProvider={dataProvider} routerProvider={routerProvider} resources={RESOURCES} options={options}>
      <Outlet />
    </Refine>
  )
}
