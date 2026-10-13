import type { RefineProps, ResourceProps } from "@refinedev/core"
import type { QueryClient } from "@tanstack/react-query"

import type { ResourceName } from "./data-provider"

/** Resource definitions and routes for Refine. */
export const RESOURCES: Array<ResourceProps & { name: ResourceName }> = [
  { name: "technicians", list: "/resources/technicians", meta: { label: "Technicians" } },
  { name: "bays", list: "/resources/bays", meta: { label: "Bays" } },
  { name: "services", list: "/resources/services", meta: { label: "Services" } },
]

/** Refine configuration sharing the app's QueryClient with telemetry and URL sync disabled. */
export function refineOptions(queryClient: QueryClient): NonNullable<RefineProps["options"]> {
  return {
    disableTelemetry: true,
    reactQuery: { clientConfig: queryClient },
    syncWithLocation: false,
    warnWhenUnsavedChanges: false,
  }
}
