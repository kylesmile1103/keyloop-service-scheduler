import { QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"

import "@/lib/api-client"
import {
  cachedVehicleAware,
  FEATURE_SWITCHES_STALE_MS,
  featureSwitchesQuery,
  featureSwitchesQueryKey,
  useVehicleAware,
  useVehicleAwareSwitch,
  vehicleAwareRefused,
} from "@/lib/feature-switches"
import { createQueryClient } from "@/lib/query-client"
import { jsonResponse, mockApi } from "@/test/mock-api"

const wrapper = (queryClient: ReturnType<typeof createQueryClient>) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

const noRetry = () => {
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  return queryClient
}

describe("the environment's vehicle-aware switch", () => {
  it("reads GET /features once and keeps it for five minutes, on top of the API's one-minute HTTP cache", async () => {
    const api = mockApi(() => jsonResponse({ vehicleAwareRequirements: true }))
    const queryClient = noRetry()

    const { result } = renderHook(() => [useVehicleAware(), useVehicleAware()], { wrapper: wrapper(queryClient) })

    await waitFor(() => expect(result.current).toEqual([true, true]))
    expect(api.requests.map((request) => new URL(request.url).pathname)).toEqual(["/api/v1/features"])
    expect(featureSwitchesQuery().staleTime).toBe(FEATURE_SWITCHES_STALE_MS)
    expect(FEATURE_SWITCHES_STALE_MS).toBe(300_000)
    expect(cachedVehicleAware(queryClient)).toBe(true)
  })

  it("is off until it has been read, and off when it cannot be read: today's flow, which every deployment accepts", async () => {
    mockApi(() => new Response("", { status: 502 }))
    const queryClient = noRetry()

    const { result } = renderHook(() => useVehicleAware(), { wrapper: wrapper(queryClient) })

    expect(result.current).toBe(false)
    await waitFor(() => expect(queryClient.getQueryState(featureSwitchesQueryKey())?.status).toBe("error"))
    expect(result.current).toBe(false)
    expect(cachedVehicleAware(queryClient)).toBe(false)
  })

  it("after a 422 vehicle-aware-requirements-disabled says off at once, then reads it again past the HTTP cache", async () => {
    let answer = { vehicleAwareRequirements: true }
    const api = mockApi(() => jsonResponse(answer))
    const queryClient = noRetry()
    const { result } = renderHook(() => useVehicleAware(), { wrapper: wrapper(queryClient) })
    await waitFor(() => expect(result.current).toBe(true))

    answer = { vehicleAwareRequirements: false }
    const refreshed = vehicleAwareRefused(queryClient)
    await waitFor(() => expect(cachedVehicleAware(queryClient)).toBe(false))
    await refreshed

    await waitFor(() => expect(result.current).toBe(false))
    const reads = api.requests.filter((request) => new URL(request.url).pathname === "/api/v1/features")
    expect(reads).toHaveLength(2)
    // The second read is not answered from the browser's cache, which may still hold the old answer for up to a minute.
    expect(reads[1].cache).toBe("reload")
  })

  it("is off when a later read fails after a successful one, in rendering and for a request being built, and on again once read", async () => {
    let fail = false
    mockApi(() => (fail ? new Response("", { status: 503 }) : jsonResponse({ vehicleAwareRequirements: true })))
    const queryClient = noRetry()
    const { result } = renderHook(() => [useVehicleAware(), useVehicleAwareSwitch()] as const, { wrapper: wrapper(queryClient) })
    await waitFor(() => expect(result.current[0]).toBe(true))
    expect(cachedVehicleAware(queryClient)).toBe(true)
    expect(result.current[1]).toEqual({ on: true, unreadable: false })

    fail = true
    await act(() => queryClient.refetchQueries({ queryKey: featureSwitchesQueryKey() }))
    expect(queryClient.getQueryState(featureSwitchesQueryKey())?.status).toBe("error")
    expect(queryClient.getQueryData(featureSwitchesQueryKey())).toEqual({ vehicleAwareRequirements: true })
    expect(cachedVehicleAware(queryClient)).toBe(false)
    await waitFor(() => expect(result.current[0]).toBe(false))
    expect(result.current[1]).toEqual({ on: false, unreadable: true })

    fail = false
    await act(() => queryClient.refetchQueries({ queryKey: featureSwitchesQueryKey() }))
    expect(cachedVehicleAware(queryClient)).toBe(true)
    await waitFor(() => expect(result.current[0]).toBe(true))
    expect(result.current[1]).toEqual({ on: true, unreadable: false })
  })

  it("says it is unreadable only after a failed read, not while the first read is out", async () => {
    mockApi(() => new Promise<Response>(() => {}))
    const queryClient = noRetry()
    const { result } = renderHook(() => useVehicleAwareSwitch(), { wrapper: wrapper(queryClient) })
    expect(result.current).toEqual({ on: false, unreadable: false })
  })

  it("stays off after a refusal when the switch cannot be read again", async () => {
    let fail = false
    mockApi(() => (fail ? new Response("", { status: 503 }) : jsonResponse({ vehicleAwareRequirements: true })))
    const queryClient = noRetry()
    const { result } = renderHook(() => useVehicleAware(), { wrapper: wrapper(queryClient) })
    await waitFor(() => expect(result.current).toBe(true))

    fail = true
    await vehicleAwareRefused(queryClient)

    await waitFor(() => expect(result.current).toBe(false))
    expect(cachedVehicleAware(queryClient)).toBe(false)
  })
})
