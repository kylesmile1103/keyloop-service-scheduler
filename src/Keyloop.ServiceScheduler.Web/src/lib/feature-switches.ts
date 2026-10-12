import { type QueryClient, useQuery } from "@tanstack/react-query"

import { getFeaturesOptions, getFeaturesQueryKey } from "@/api/@tanstack/react-query.gen"
import { getFeatures } from "@/api/sdk.gen"
import type { FeatureSwitchesResponse } from "@/api/types.gen"

/**
 * The environment's rendering switches (`GET /api/v1/features`, Task 31b.0): today only whether vehicle-aware requirements
 * are on (ADR-029). The answer is the same for every caller and fixed for the API process (a restart changes it), so it is
 * read once and shared, and kept when who is signed in changes (lib/session-cache.ts).
 *
 * Freshness: five minutes in the app (`staleTime`), on top of the API's own `Cache-Control: public, max-age=60`. A restart
 * that turns the switch on is noticed on the next read after that, which only adds controls; one that turns it off can
 * answer a vehicle-aware request with `422 vehicle-aware-requirements-disabled` meanwhile, and `vehicleAwareRefused`
 * handles that at once. Reading it more often would buy nothing the 422 path does not already give.
 */
export const FEATURE_SWITCHES_STALE_MS = 5 * 60_000

export const featureSwitchesQuery = () => ({
  ...getFeaturesOptions(),
  staleTime: FEATURE_SWITCHES_STALE_MS,
})

/** The switch's query key, for a refresh or a test. */
export const featureSwitchesQueryKey = () => getFeaturesQueryKey()

/**
 * Whether vehicle-aware booking inputs, availability filters and allocation explanations are on. `false` until the switch
 * has been read and when it cannot be read: today's flow, which every deployment accepts (with the switch on, an omitted
 * vehicle profile is treated as Unknown, the conservative default).
 */
export function useVehicleAware(): boolean {
  return useQuery(featureSwitchesQuery()).data?.vehicleAwareRequirements === true
}

/** The switch as the cache holds it at this moment, for a decision taken outside rendering (a request as it is built). */
export function cachedVehicleAware(queryClient: QueryClient): boolean {
  return queryClient.getQueryData<FeatureSwitchesResponse>(featureSwitchesQueryKey())?.vehicleAwareRequirements === true
}

/**
 * The API refused a vehicle-aware input with `422 vehicle-aware-requirements-disabled`: the switch the app read is stale.
 * A read still out is cancelled (so it cannot put the old answer back), the cache says off, so no view sends another
 * vehicle-aware input, and the switch is read again past the browser's HTTP cache (`cache: "reload"`, which also replaces
 * the cached response every later read gets). Every view follows that answer. Unreadable, it stays off, which every
 * deployment accepts.
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
