import { type QueryClient, useQuery } from "@tanstack/react-query"

import { getFeaturesOptions, getFeaturesQueryKey } from "@/api/@tanstack/react-query.gen"
import { getFeatures } from "@/api/sdk.gen"
import type { FeatureSwitchesResponse } from "@/api/types.gen"

/** Stale time (5 minutes) for `GET /api/v1/features`. */
export const FEATURE_SWITCHES_STALE_MS = 5 * 60_000

export const featureSwitchesQuery = () => ({
  ...getFeaturesOptions(),
  staleTime: FEATURE_SWITCHES_STALE_MS,
})

export const featureSwitchesQueryKey = () => getFeaturesQueryKey()

/** Returns true only when the latest fetch succeeded with `vehicleAwareRequirements: true`. */
function switchedOn(state: { status: "pending" | "error" | "success"; data?: FeatureSwitchesResponse } | undefined): boolean {
  return state?.status === "success" && state.data?.vehicleAwareRequirements === true
}

/** Returns whether vehicle-aware requirements are enabled (`on`) and whether the switch query failed (`unreadable`). */
export function useVehicleAwareSwitch(): { on: boolean; unreadable: boolean } {
  const query = useQuery(featureSwitchesQuery())
  return { on: switchedOn(query), unreadable: query.status === "error" }
}

/** Whether vehicle-aware booking inputs, availability filters, and allocation explanations are enabled. */
export function useVehicleAware(): boolean {
  return useVehicleAwareSwitch().on
}

/** Reads the vehicle-aware switch synchronously from the query cache outside rendering. */
export function cachedVehicleAware(queryClient: QueryClient): boolean {
  return switchedOn(queryClient.getQueryState<FeatureSwitchesResponse>(featureSwitchesQueryKey()))
}

/**
 * Handles `422 vehicle-aware-requirements-disabled` by immediately disabling the cached switch
 * and re-fetching `/api/v1/features` bypassing the browser HTTP cache (`cache: "reload"`).
 */
export async function vehicleAwareRefused(queryClient: QueryClient): Promise<void> {
  const queryKey = featureSwitchesQueryKey()
  await queryClient.cancelQueries({ queryKey })
  queryClient.setQueryData<FeatureSwitchesResponse>(queryKey, { vehicleAwareRequirements: false })
  try {
    await queryClient.fetchQuery({
      queryKey,
      queryFn: async ({ signal }) => (await getFeatures({ cache: "reload", signal, throwOnError: true })).data,
      staleTime: 0,
    })
  } catch {
    // Kept off.
  }
}
