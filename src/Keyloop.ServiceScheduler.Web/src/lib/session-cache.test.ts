import { QueryObserver } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"

import {
  getAppointmentQueryKey,
  getAvailabilityQueryKey,
  getBookingTriageStatusQueryKey,
  getCurrentUserQueryKey,
  getDealershipsQueryKey,
  getServiceTypesQueryKey,
  getWorkshopScheduleQueryKey,
  listAppointmentsQueryKey,
} from "@/api/@tanstack/react-query.gen"
import type { GetAvailabilityData, ListAppointmentsData } from "@/api/types.gen"
import { createQueryClient } from "@/lib/query-client"
import { clearCallerData, holdsCallerData } from "@/lib/session-cache"
import { reading } from "@/test/dealerships"
import { admin } from "@/test/identities"

const dealershipId = reading.id
const keys = {
  me: getCurrentUserQueryKey(),
  dealerships: getDealershipsQueryKey(),
  serviceTypes: getServiceTypesQueryKey({ path: { dealershipId } }),
  triageStatus: getBookingTriageStatusQueryKey(),
  schedule: getWorkshopScheduleQueryKey({ path: { dealershipId }, query: { date: "2026-10-13" } }),
  range: listAppointmentsQueryKey({ path: { dealershipId }, query: { from: "2026-10-13", to: "2026-10-19" } as ListAppointmentsData["query"] }),
  availability: getAvailabilityQueryKey({ path: { dealershipId }, query: { date: "2026-10-13" } as GetAvailabilityData["query"] }),
  details: getAppointmentQueryKey({ path: { appointmentId: "8c1f6b3e-5d2a-4f7b-9e1c-3a2b4c5d6e7f" } }),
  // The admin area's Refine cache, whose lists come from the schedule.
  refine: ["default", "technicians", "list", {}],
}

const personal = { customerName: "Sophie Turner", vin: "JTDKN3DU0A0123460", registration: "RF20 BCJ" }

/** A cache as a signed-in Admin leaves it: the identity, reference data, and every caller-dependent read with full names. */
function seeded() {
  const queryClient = createQueryClient()
  const reference: readonly unknown[] = [keys.dealerships, keys.serviceTypes, keys.triageStatus]
  for (const key of Object.values(keys)) {
    queryClient.setQueryData(key, key === keys.me ? admin : reference.includes(key) ? { reference: true } : personal)
  }
  return queryClient
}

const held = (queryClient: ReturnType<typeof createQueryClient>) =>
  queryClient
    .getQueryCache()
    .getAll()
    .filter((query) => query.state.data !== undefined)
    .map((query) => query.queryHash)

describe("which reads may hold another caller's data", () => {
  it("keeps the identity and the caller-independent reference reads, and clears everything else", () => {
    const queryClient = seeded()
    const holds = (key: readonly unknown[]) => holdsCallerData(queryClient.getQueryCache().find({ queryKey: key, exact: true })!)

    expect([keys.me, keys.dealerships, keys.serviceTypes, keys.triageStatus].map(holds)).toEqual([false, false, false, false])
    expect([keys.schedule, keys.range, keys.availability, keys.details, keys.refine].map(holds)).toEqual([true, true, true, true, true])
  })
})

describe("clearing what the previous caller read", () => {
  it("removes every query nobody shows, so none of its personal data stays in the cache", () => {
    const queryClient = seeded()

    clearCallerData(queryClient)

    const remaining = queryClient.getQueryCache().getAll().map((query) => query.queryKey)
    expect(remaining).toEqual([keys.me, keys.dealerships, keys.serviceTypes, keys.triageStatus])
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((query) => query.state.data))).not.toContain("Sophie Turner")
  })

  it("resets a query on screen to never loaded, without reading it again yet", async () => {
    const queryClient = seeded()
    let reads = 0
    const observer = new QueryObserver(queryClient, {
      queryKey: keys.schedule,
      queryFn: () => {
        reads++
        return personal
      },
      staleTime: Infinity,
    })
    const results: unknown[] = []
    const stop = observer.subscribe((result) => results.push(result.data))

    clearCallerData(queryClient)

    expect(queryClient.getQueryData(keys.schedule)).toBeUndefined()
    expect(held(queryClient)).not.toContain(queryClient.getQueryCache().find({ queryKey: keys.schedule })!.queryHash)
    // The view sees the reset (loading), and nothing is read until refetchCallerData asks.
    expect(results.at(-1)).toBeUndefined()
    expect(reads).toBe(0)
    stop()
  })

  it("drops finished mutations, whose variables and answers hold customers' details, and keeps one still running", async () => {
    const queryClient = createQueryClient()
    const mutations = queryClient.getMutationCache()
    await mutations.build(queryClient, { mutationFn: async () => personal }).execute({ customer: { name: "Grace Hopper" } })
    const running = mutations.build(queryClient, { mutationFn: () => new Promise(() => {}) })
    void running.execute({ customer: { name: "Ada Lovelace" } })

    clearCallerData(queryClient)

    expect(mutations.getAll()).toEqual([running])
  })
})
