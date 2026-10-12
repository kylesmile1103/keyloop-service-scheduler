import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getServiceTypesQueryKey, getWorkshopScheduleQueryKey } from "@/api/@tanstack/react-query.gen"
import { createQueryClient } from "@/lib/query-client"
import { mockBoardApi, requestsTo } from "@/test/board-api"
import { munichCatalogue } from "@/test/catalogue"
import { munich, reading } from "@/test/dealerships"
import { problemResponse } from "@/test/mock-api"
import { readingTuesday, technicians } from "@/test/schedules"

import { createSchedulerDataProvider, RESOURCE_NAMES } from "./data-provider"
import type { BayRecord, ServiceRecord, TechnicianRecord } from "./resources"

const meta = { dealershipId: reading.id, date: "2026-10-13" }
const traceId = "00-438d4c830068d5c9ac8829d1ed9a62c4-688a07bcce305407-01"

function setup() {
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  return { queryClient, dataProvider: createSchedulerDataProvider(queryClient) }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

describe("the resources data provider", () => {
  it("names the three read-only resources", () => {
    expect(RESOURCE_NAMES).toEqual(["technicians", "bays", "services"])
  })

  it("lists technicians and bays from the day's schedule read, cached under the board's own query key", async () => {
    const { requests } = mockBoardApi()
    const { queryClient, dataProvider } = setup()

    const people = await dataProvider.getList<TechnicianRecord>({ resource: "technicians", meta })
    const lanes = await dataProvider.getList<BayRecord>({ resource: "bays", meta })

    expect(people.total).toBe(6)
    expect(people.data.map((record) => record.name)).toEqual(readingTuesday.technicians.map((entry) => entry.name))
    expect(people.data.find((record) => record.id === technicians.chloe.id)?.today).toEqual({ appointments: 2, bookedMinutes: 135, windowMinutes: 600 })
    expect(lanes.data.map((record) => record.name)).toEqual(readingTuesday.bays.map((entry) => entry.name))
    expect(people.day).toEqual({ date: "2026-10-13", operatingWindow: readingTuesday.operatingWindow })
    // One schedule read serves both lists, and the board would open from the same cache entry.
    expect(requestsTo(requests, "/schedule")).toHaveLength(1)
    expect(new URL(requests[0].url).search).toBe("?date=2026-10-13")
    expect(queryClient.getQueryData(getWorkshopScheduleQueryKey({ path: { dealershipId: reading.id }, query: { date: "2026-10-13" } }))).toEqual(
      readingTuesday
    )
  })

  it("lists services from the catalogue read, with today's bookings from the schedule", async () => {
    const { requests } = mockBoardApi({ serviceTypes: () => munichCatalogue })
    const { queryClient, dataProvider } = setup()

    const services = await dataProvider.getList<ServiceRecord>({ resource: "services", meta: { ...meta, dealershipId: munich.id } })

    expect(services.total).toBe(10)
    expect(services.data.find((record) => record.code === "MOT-TEST")).toMatchObject({
      bookable: false,
      bookedToday: 0,
      shortfall: { capabilities: ["MotTesting"], certifications: ["MotTester"], splitAcrossBays: false, splitAcrossTechnicians: false },
    })
    expect(requestsTo(requests, "/service-types")).toHaveLength(1)
    expect(queryClient.getQueryData(getServiceTypesQueryKey({ path: { dealershipId: munich.id } }))).toEqual(munichCatalogue)
  })

  it("pages a list when Refine asks it to, and keeps the whole count", async () => {
    mockBoardApi()
    const { dataProvider } = setup()

    const page = await dataProvider.getList<TechnicianRecord>({
      resource: "technicians",
      meta,
      pagination: { mode: "server", currentPage: 2, pageSize: 4 },
    })

    expect(page.data.map((record) => record.name)).toEqual(["Eva Lindqvist", "Farid Haddad"])
    expect(page.total).toBe(6)
  })

  it("refuses filters and sorters it would otherwise ignore: the pages filter and sort the rows themselves", async () => {
    mockBoardApi()
    const { dataProvider } = setup()

    await expect(
      dataProvider.getList({ resource: "technicians", meta, filters: [{ field: "isActive", operator: "eq", value: true }] })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("filter and sort") })
    await expect(dataProvider.getList({ resource: "technicians", meta, sorters: [{ field: "name", order: "asc" }] })).rejects.toMatchObject({
      statusCode: 400,
    })
    // Refine's own empty defaults are fine.
    await expect(dataProvider.getList({ resource: "technicians", meta, filters: [], sorters: [] })).resolves.toMatchObject({ total: 6 })
  })

  it("maps the API's problem to Refine's HttpError, keeping its trace id", async () => {
    mockBoardApi({
      schedule: () =>
        problemResponse(404, {
          type: "https://api.keyloop.example/problems/not-found",
          title: "Resource not found",
          status: 404,
          detail: `No dealership with id '${reading.id}' exists.`,
          traceId,
        }),
    })
    const { dataProvider } = setup()

    await expect(dataProvider.getList({ resource: "bays", meta })).rejects.toMatchObject({
      statusCode: 404,
      message: `No dealership with id '${reading.id}' exists.`,
      traceId,
    })
  })

  it("needs a dealership and a date, and knows only its three resources", async () => {
    mockBoardApi()
    const { dataProvider } = setup()

    await expect(dataProvider.getList({ resource: "technicians", meta: { date: "2026-10-13" } })).rejects.toMatchObject({ statusCode: 400 })
    await expect(dataProvider.getList({ resource: "appointments", meta })).rejects.toMatchObject({
      statusCode: 404,
      message: "There is no resource called appointments.",
    })
  })

  it("reads one record, or several, from the list", async () => {
    mockBoardApi()
    const { dataProvider } = setup()

    await expect(dataProvider.getOne<TechnicianRecord>({ resource: "technicians", id: technicians.ben.id, meta })).resolves.toMatchObject({
      data: { name: "Ben Okafor", employeeNumber: "T-1002" },
    })
    await expect(
      dataProvider.getMany!<TechnicianRecord>({ resource: "technicians", ids: [technicians.farid.id, technicians.amelia.id], meta })
    ).resolves.toMatchObject({ data: [{ name: "Farid Haddad" }, { name: "Amelia Clarke" }] })
    await expect(dataProvider.getOne({ resource: "technicians", id: "missing", meta })).rejects.toMatchObject({
      statusCode: 404,
      message: "No technicians record with id missing at this dealership.",
    })
  })

  it("is read-only: creating, changing or deleting fails loudly until editing is built", async () => {
    const { requests } = mockBoardApi()
    const { dataProvider } = setup()
    const readOnly = { statusCode: 405, message: "The technicians list is read-only." }

    await expect(dataProvider.create({ resource: "technicians", variables: { name: "New" }, meta })).rejects.toMatchObject(readOnly)
    await expect(dataProvider.update({ resource: "technicians", id: technicians.ben.id, variables: { name: "Ben" }, meta })).rejects.toMatchObject(
      readOnly
    )
    await expect(dataProvider.deleteOne({ resource: "technicians", id: technicians.ben.id, meta })).rejects.toMatchObject(readOnly)
    expect(requests).toHaveLength(0)
  })
})
