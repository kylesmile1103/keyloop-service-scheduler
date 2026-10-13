import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getServiceTypesQueryKey, getWorkshopScheduleQueryKey } from "@/api/@tanstack/react-query.gen"
import { createQueryClient } from "@/lib/query-client"
import { mockBoardApi, requestsTo } from "@/test/board-api"
import { munichCatalogue } from "@/test/catalogue"
import { munich, reading } from "@/test/dealerships"
import { problemResponse } from "@/test/mock-api"
import type { AdminTechnicianResponse } from "@/api/types.gen"
import { adminServer } from "@/test/admin-api"
import { admin as adminIdentity } from "@/test/identities"
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
  it("names its three resources", () => {
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

    expect(services.total).toBe(11)
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

  it("lists the roster for an Admin from the Admin read, each with its version, and today's work from the schedule", async () => {
    const admin = adminServer()
    const { requests } = mockBoardApi({ me: () => adminIdentity, admin })
    const { dataProvider } = setup()

    const people = await dataProvider.getList<TechnicianRecord>({ resource: "technicians", meta: { ...meta, view: "admin" } })
    const lanes = await dataProvider.getList<BayRecord>({ resource: "bays", meta: { ...meta, view: "admin" } })

    expect(people.data.map((record) => record.name)).toEqual(readingTuesday.technicians.map((entry) => entry.name))
    expect(people.data.find((record) => record.id === technicians.chloe.id)).toMatchObject({
      version: admin.state.technicians.find((record) => record.id === technicians.chloe.id)!.version,
      hvLevel: 2,
      hvLevelConfirmed: true,
      today: { appointments: 2, bookedMinutes: 135, windowMinutes: 600 },
    })
    expect(lanes.data.every((record) => typeof record.version === "number")).toBe(true)
    expect(requestsTo(requests, "/technicians")).toHaveLength(1)
    expect(requestsTo(requests, "/bays")).toHaveLength(1)
    // The day's load still comes from the board's one schedule read.
    expect(requestsTo(requests, "/schedule")).toHaveLength(1)
  })

  it("reads one record for an Admin's form from the Admin read, fresh, with its version", async () => {
    const admin = adminServer()
    const { requests } = mockBoardApi({ me: () => adminIdentity, admin })
    const { dataProvider } = setup()

    await expect(dataProvider.getOne<TechnicianRecord>({ resource: "technicians", id: technicians.ben.id, meta: { ...meta, view: "admin" } })).resolves.toMatchObject({
      data: { name: "Ben Okafor", version: admin.state.technicians[1].version, hvLevel: 3 },
    })
    expect(requestsTo(requests, `/technicians/${technicians.ben.id}`)).toHaveLength(1)
  })

  it("sends an Admin's edit with the version it was made from, through the fetch it is given", async () => {
    const admin = adminServer()
    const { requests } = mockBoardApi({ me: () => adminIdentity, admin })
    const { dataProvider } = setup()
    const ben = admin.state.technicians[1]
    const bound = vi.fn<typeof fetch>((input, init) => fetch(input, init))
    const variables = { ...writeOf(ben), name: "Ben Okafor-Smith" }

    const saved = await dataProvider.update({
      resource: "technicians",
      id: ben.id,
      variables,
      meta: { ...meta, fetch: bound, ifMatch: `"${ben.version}"` },
    })

    expect(saved.data).toMatchObject({ name: "Ben Okafor-Smith" })
    expect(bound).toHaveBeenCalledOnce()
    const put = requests.find((request) => request.method === "PUT")!
    expect(put.headers.get("If-Match")).toBe(`"${ben.version}"`)
    expect(await put.clone().json()).toEqual(variables)
  })

  it("adds a technician or a bay without a version: there is no record to match yet", async () => {
    const admin = adminServer()
    const { requests } = mockBoardApi({ me: () => adminIdentity, admin })
    const { dataProvider } = setup()

    const body = { name: "Bay 7 - Tyres", capabilities: ["StandardLift"], isActive: true }
    await expect(dataProvider.create({ resource: "bays", variables: body, meta: { ...meta, fetch } })).resolves.toMatchObject({ data: { name: "Bay 7 - Tyres" } })
    const post = requests.find((request) => request.method === "POST")!
    expect(post.headers.has("If-Match")).toBe(false)
  })

  it("maps a stale edit's 412 to Refine's HttpError, keeping the current representation for the conflict", async () => {
    const admin = adminServer()
    mockBoardApi({ me: () => adminIdentity, admin })
    const { dataProvider } = setup()
    const ben = admin.state.technicians[1]
    const now = admin.editedElsewhere.technician(ben.id, { hvLevel: 2 })

    const refused = await dataProvider
      .update({ resource: "technicians", id: ben.id, variables: writeOf(ben), meta: { ...meta, fetch, ifMatch: `"${ben.version}"` } })
      .catch((error: unknown) => error)

    expect(refused).toMatchObject({ statusCode: 412, cause: { currentETag: `"${now.version}"`, current: { hvLevel: 2 } } })
  })

  it("never sends an edit without the bound fetch, deletes nothing, and keeps the services read-only", async () => {
    const admin = adminServer()
    const { requests } = mockBoardApi({ me: () => adminIdentity, admin })
    const { dataProvider } = setup()
    const ben = admin.state.technicians[1]

    await expect(
      dataProvider.update({ resource: "technicians", id: ben.id, variables: writeOf(ben), meta: { ...meta, ifMatch: `"${ben.version}"` } })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("bound") })
    await expect(dataProvider.create({ resource: "technicians", variables: writeOf(ben), meta })).rejects.toMatchObject({ statusCode: 400 })
    await expect(dataProvider.deleteOne({ resource: "technicians", id: ben.id, meta })).rejects.toMatchObject({
      statusCode: 405,
      message: "Technicians are never deleted: deactivate one instead, so its appointments and history stay.",
    })
    await expect(dataProvider.deleteOne({ resource: "bays", id: "any", meta })).rejects.toMatchObject({ statusCode: 405 })
    await expect(dataProvider.update({ resource: "services", id: "any", variables: {}, meta: { ...meta, fetch } })).rejects.toMatchObject({
      statusCode: 405,
      message: "The services list is read-only.",
    })
    expect(requests).toHaveLength(0)
  })
})

const writeOf = (record: AdminTechnicianResponse) => ({
  name: record.name,
  employeeNumber: record.employeeNumber,
  certifications: record.certifications,
  isActive: record.isActive,
  hvLevel: record.hvLevel,
  hvLevelValidUntil: record.hvLevelValidUntil,
  hvLevelConfirmed: record.hvLevelConfirmed,
  brandSpecialisms: record.brandSpecialisms,
})
