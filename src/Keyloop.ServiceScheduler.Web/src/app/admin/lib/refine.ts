import type { RefineProps, ResourceProps } from "@refinedev/core"
import type { QueryClient } from "@tanstack/react-query"

import type { ResourceName } from "./data-provider"

/** The admin area's resources and the routes that list them (Task 30 adds their create and edit routes). */
export const RESOURCES: Array<ResourceProps & { name: ResourceName }> = [
  { name: "technicians", list: "/resources/technicians", meta: { label: "Technicians" } },
  { name: "bays", list: "/resources/bays", meta: { label: "Bays" } },
  { name: "services", list: "/resources/services", meta: { label: "Services" } },
]

/**
 * Refine's options for this app (ADR-031):
 * - `disableTelemetry`: Refine core otherwise sends a usage beacon to telemetry.refine.dev on start; nothing may leave for
 *   any origin but the app's (the production CSP's `connect-src 'self'` stays as it is).
 * - `reactQuery.clientConfig`: the app's own QueryClient, so Refine's lists and the board's reads share one cache.
 * - `syncWithLocation` off: the address belongs to the app's own parameters (`?dealership=`); table state stays in the page.
 * - No devtools: `@refinedev/devtools` is not installed and no `DevtoolsProvider` is mounted, so nothing connects to
 *   Refine's devtools server.
 */
export function refineOptions(queryClient: QueryClient): NonNullable<RefineProps["options"]> {
  return {
    disableTelemetry: true,
    reactQuery: { clientConfig: queryClient },
    syncWithLocation: false,
    warnWhenUnsavedChanges: false,
  }
}
