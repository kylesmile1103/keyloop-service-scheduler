import { type QueryClient, QueryObserver } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"

import {
  getAppointmentQueryKey,
  getAvailabilityQueryKey,
  getBookingTriageStatusQueryKey,
  getCurrentUserQueryKey,
  getDealershipsQueryKey,
  getFeaturesQueryKey,
  getServiceTypesQueryKey,
  getWorkshopScheduleQueryKey,
  listAppointmentsQueryKey,
} from "@/api/@tanstack/react-query.gen"
import type { GetAvailabilityData, ListAppointmentsData } from "@/api/types.gen"
import { calendarRange } from "@/app/calendar/lib/calendar"
import { overviewWindow } from "@/app/overview/lib/overview"
import { rangeReadOptions } from "@/lib/appointment-range"
import { createQueryClient } from "@/lib/query-client"
import {
  bindWrite,
  CallerChangedError,
  callerGeneration,
  clearCallerData,
  holdsCallerData,
  WriteNotAllowedError,
} from "@/lib/session-cache"
import type { CurrentUserResponse } from "@/api/types.gen"
import { reading } from "@/test/dealerships"
import { admin, anonymous, viewer } from "@/test/identities"

const dealershipId = reading.id
const keys = {
  me: getCurrentUserQueryKey(),
  dealerships: getDealershipsQueryKey(),
  serviceTypes: getServiceTypesQueryKey({ path: { dealershipId } }),
  triageStatus: getBookingTriageStatusQueryKey(),
  schedule: getWorkshopScheduleQueryKey({ path: { dealershipId }, query: { date: "2026-10-13" } }),
  range: listAppointmentsQueryKey({ path: { dealershipId }, query: { from: "2026-10-13", to: "2026-10-19" } as ListAppointmentsData["query"] }),
  // The Overview's read, built as the page builds it (Task 28b).
  overview: rangeReadOptions(dealershipId, overviewWindow("2026-10-13").from, overviewWindow("2026-10-13").to).queryKey,
  // The Calendar's month, built as the page builds it.
  calendar: rangeReadOptions(dealershipId, calendarRange("month", "2026-10-13").from, calendarRange("month", "2026-10-13").to).queryKey,
  // The Calendar's week, its default view.
  calendarWeek: rangeReadOptions(dealershipId, calendarRange("week", "2026-10-13").from, calendarRange("week", "2026-10-13").to).queryKey,
  availability: getAvailabilityQueryKey({ path: { dealershipId }, query: { date: "2026-10-13" } as GetAvailabilityData["query"] }),
  // Task 31b: the environment's switches stay; availability read for a vehicle (its profile in the key) goes like any other.
  features: getFeaturesQueryKey(),
  vehicleAvailability: getAvailabilityQueryKey({
    path: { dealershipId },
    query: {
      serviceTypeId: "3153f30d-5700-8f07-a25d-4a4ea44dfeef",
      date: "2026-10-13",
      powertrain: "BatteryElectric",
      manufacturer: "VOLKSWAGEN",
      vehicleClass: "Car",
      needsLiveDiagnosis: true,
    },
  }),
  details: getAppointmentQueryKey({ path: { appointmentId: "8c1f6b3e-5d2a-4f7b-9e1c-3a2b4c5d6e7f" } }),
  // The admin area's Refine cache, whose lists come from the schedule.
  refine: ["default", "technicians", "list", {}],
}

const personal = { customerName: "Sophie Turner", vin: "JTDKN3DU0A0123460", registration: "RF20 BCJ" }

/** A cache as a signed-in Admin leaves it: the identity, reference data, and every caller-dependent read with full names. */
function seeded() {
  const queryClient = createQueryClient()
  const reference: readonly unknown[] = [keys.dealerships, keys.serviceTypes, keys.triageStatus, keys.features]
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

    expect([keys.me, keys.dealerships, keys.serviceTypes, keys.triageStatus, keys.features].map(holds)).toEqual([false, false, false, false, false])
    expect(
      [keys.schedule, keys.range, keys.overview, keys.calendar, keys.calendarWeek, keys.availability, keys.vehicleAvailability, keys.details, keys.refine].map(
        holds,
      ),
    ).toEqual([true, true, true, true, true, true, true, true, true])
  })
})

describe("clearing what the previous caller read", () => {
  it("removes every query nobody shows, so none of its personal data stays in the cache", () => {
    const queryClient = seeded()

    clearCallerData(queryClient)

    const remaining = queryClient.getQueryCache().getAll().map((query) => query.queryKey)
    expect(remaining).toEqual([keys.me, keys.dealerships, keys.serviceTypes, keys.triageStatus, keys.features])
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

  it("clears the Overview's and the Calendar's range reads as the pages build them: reset while shown, removed otherwise", () => {
    const queryClient = seeded()
    // The Overview on screen; the Calendar's week and month read earlier and no longer shown.
    const observer = new QueryObserver(queryClient, { queryKey: keys.overview, queryFn: () => personal, staleTime: Infinity })
    const stop = observer.subscribe(() => {})

    clearCallerData(queryClient)

    const cache = queryClient.getQueryCache()
    expect(cache.find({ queryKey: keys.overview, exact: true })?.state.data).toBeUndefined()
    expect([keys.calendarWeek, keys.calendar].map((key) => cache.find({ queryKey: key, exact: true }))).toEqual([undefined, undefined])
    expect(JSON.stringify(cache.getAll().map((query) => query.state.data))).not.toContain("Sophie Turner")
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

  it("drops a mutation that was still running as soon as it settles, its answer the previous caller's", async () => {
    const queryClient = createQueryClient()
    const mutations = queryClient.getMutationCache()
    let answer!: (value: unknown) => void
    const running = mutations.build(queryClient, { mutationFn: () => new Promise((resolve) => (answer = resolve)) })
    const done = running.execute({ customer: { name: "Ada Lovelace" } })
    await vi.waitFor(() => expect(answer).toBeTypeOf("function"))

    clearCallerData(queryClient)
    expect(mutations.getAll()).toEqual([running])
    answer(personal)
    await done

    expect(mutations.getAll()).toEqual([])
  })

  it("counts each change, so a write can tell that the caller changed while it ran", () => {
    const queryClient = createQueryClient()
    const before = callerGeneration(queryClient)

    clearCallerData(queryClient)
    clearCallerData(queryClient)

    expect(callerGeneration(queryClient)).toBe(before + 2)
    expect(callerGeneration(createQueryClient())).toBe(0)
  })
})

describe("a write's account, checked inside the fetch its requests are given (bindWrite)", () => {
  const owner = "admin@keyloop.test"
  const otherAdmin: CurrentUserResponse = { ...admin, email: "another.admin@keyloop.test" }
  const sameEmailAdvisor: CurrentUserResponse = { ...admin, roles: ["ServiceAdvisor"] }
  const url = "http://localhost:3000/api/v1/dealerships/d/appointments"

  /** A cache for the Admin, and a change of caller as SessionWatch makes it: the new `/me` and the cleared cache. */
  function signedIn() {
    const queryClient = createQueryClient()
    queryClient.setQueryData(keys.me, admin)
    const becomes = (next: CurrentUserResponse) => {
      queryClient.setQueryData(keys.me, next)
      clearCallerData(queryClient)
    }
    const base = vi.fn<typeof fetch>(async () => new Response("{}", { status: 201 }))
    return { queryClient, becomes, base }
  }

  it("hands the request to the fetch it wraps while the cache names the write's account", async () => {
    const { queryClient, base } = signedIn()
    const request = new Request(url, { method: "POST" })

    const response = await bindWrite(queryClient, owner).fetch(base)(request)

    expect(response.status).toBe(201)
    expect(base).toHaveBeenCalledExactlyOnceWith(request, undefined)
  })

  it("looks the page's fetch up as the request leaves when it wraps none (a test's stub, the tracing instrumentation)", async () => {
    const { queryClient, base } = signedIn()
    const fetch = bindWrite(queryClient, owner).fetch()
    vi.stubGlobal("fetch", base)

    await fetch(url, { method: "POST" })

    expect(base).toHaveBeenCalledOnce()
  })

  it.each<[string, (queryClient: QueryClient) => void]>([
    ["signed out", (queryClient) => queryClient.setQueryData(keys.me, anonymous)],
    ["a Viewer", (queryClient) => queryClient.setQueryData(keys.me, viewer)],
    ["another account that may write", (queryClient) => queryClient.setQueryData(keys.me, otherAdmin)],
    [
      "nobody known (/me's last read failed)",
      (queryClient) => queryClient.getQueryCache().find({ queryKey: keys.me })!.setState({ status: "error", fetchFailureCount: 1 }),
    ],
  ])("refuses, as the client calls it, once the identity in the cache is %s: nothing reaches the fetch it wraps", async (_, change) => {
    const { queryClient, base } = signedIn()
    const fetch = bindWrite(queryClient, owner).fetch(base)

    change(queryClient)

    await expect(fetch(url, { method: "POST" })).rejects.toBeInstanceOf(WriteNotAllowedError)
    expect(base).not.toHaveBeenCalled()
  })

  it("decides synchronously, when it is called, with nothing awaited before the request is handed on", () => {
    const { queryClient, base } = signedIn()
    const fetch = bindWrite(queryClient, owner).fetch(base)

    void fetch(url, { method: "POST" })
    queryClient.setQueryData(keys.me, otherAdmin)
    expect(base).toHaveBeenCalledOnce()

    void fetch(url, { method: "POST" }).catch(() => {})
    expect(base).toHaveBeenCalledOnce()
  })

  it("lets a write leave as the same email in another role that may write, before its first request: its answers are theirs", async () => {
    const { queryClient, becomes, base } = signedIn()
    const write = bindWrite(queryClient, owner)

    becomes(sameEmailAdvisor)
    expect(write.stale()).toBe(true)
    await write.fetch(base)(url, { method: "POST" })

    expect(base).toHaveBeenCalledOnce()
    expect(write.stale()).toBe(false)
    expect(() => write.guard()).not.toThrow()
  })

  it("sends every request of one write as one caller: after its first request left, any change stops the next one", async () => {
    const { queryClient, becomes, base } = signedIn()
    const write = bindWrite(queryClient, owner)
    await write.fetch(base)(url, { method: "POST" })

    becomes(sameEmailAdvisor)

    expect(write.stale()).toBe(true)
    expect(() => write.guard()).toThrow(CallerChangedError)
    await expect(write.fetch(base)(url, { method: "POST" })).rejects.toBeInstanceOf(CallerChangedError)
    expect(base).toHaveBeenCalledOnce()
  })
})
