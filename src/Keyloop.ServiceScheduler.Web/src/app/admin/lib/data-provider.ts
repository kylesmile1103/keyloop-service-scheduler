import type { BaseKey, BaseRecord, CrudFilter, CrudSort, DataProvider, GetListResponse, MetaQuery, Pagination } from "@refinedev/core"
import type { QueryClient } from "@tanstack/react-query"

import { getServiceTypesOptions, getWorkshopScheduleOptions } from "@/api/@tanstack/react-query.gen"
import type { OperatingWindowResponse, WorkshopScheduleResponse } from "@/api/types.gen"

import { refusal, toHttpError } from "./http-error"
import { bayRecords, serviceRecords, technicianRecords } from "./resources"

/** The resources the admin area lists; Task 30 makes them editable. */
export const RESOURCE_NAMES = ["technicians", "bays", "services"] as const

export type ResourceName = (typeof RESOURCE_NAMES)[number]

/** What every list is about: one dealership's resources, measured on one of its days (today on the resources pages). */
export interface ResourceScope {
  dealershipId: string
  /** The dealership's calendar date, `yyyy-MM-dd`. */
  date: string
}

/** The day a list's figures were measured on: its date and opening window (`null` when the dealership is closed). */
export interface ResourceDay {
  date: string
  operatingWindow: OperatingWindowResponse | null
}

/** `getList`'s answer: the records, their count, and the day they were measured on. */
export interface ResourceListResponse<TData> extends GetListResponse<TData> {
  day: ResourceDay
}

function scopeOf(meta: MetaQuery | undefined): ResourceScope {
  const dealershipId = meta?.dealershipId
  const date = meta?.date
  if (typeof dealershipId !== "string" || typeof date !== "string") {
    throw refusal(400, "The resource lists need a dealership id and a date (yyyy-MM-dd) in meta.")
  }
  return { dealershipId, date }
}

/** Filters and sorters this provider would have to ignore: the pages filter and sort their rows with TanStack Table. */
function refuseServerQueries(filters: readonly CrudFilter[] | undefined, sorters: readonly CrudSort[] | undefined) {
  if ((filters?.length ?? 0) > 0 || (sorters?.length ?? 0) > 0) {
    throw refusal(400, "The resource lists filter and sort in the page: the API has no filtered or sorted reads.")
  }
}

/** A read through the shared cache, its failure mapped to Refine's `HttpError`. */
async function reading<T>(read: Promise<T>): Promise<T> {
  try {
    return await read
  } catch (error) {
    throw toHttpError(error)
  }
}

/** A page of the list when Refine pages on the "server" (here); the whole list otherwise. */
function paged<T>(records: readonly T[], pagination: Pagination | undefined): T[] {
  if (pagination?.mode !== "server") return [...records]
  const pageSize = pagination.pageSize ?? 10
  const currentPage = pagination.currentPage ?? 1
  return records.slice((currentPage - 1) * pageSize, currentPage * pageSize)
}

/**
 * A read-only Refine data provider over the generated HeyAPI client, for the resources pages (ARCHITECTURE §15, ADR-031).
 *
 * The API has no generic REST resources: technicians and bays come from the day's schedule read (`GET /schedule`) and
 * services from the catalogue (`GET /service-types`). Both reads go through the app's own QueryClient with the generated
 * query options, so they share the dispatch board's cache entries (one cache, one request for the same day), and every
 * failure becomes Refine's `HttpError` with the API's status, words, trace id and field errors. Creating, changing and
 * deleting refuse with 405 until the admin dashboard's editing (Task 30) is built.
 */
export function createSchedulerDataProvider(queryClient: QueryClient): DataProvider {
  const schedule = ({ dealershipId, date }: ResourceScope) =>
    reading(queryClient.fetchQuery(getWorkshopScheduleOptions({ path: { dealershipId }, query: { date } })))
  const catalogue = ({ dealershipId }: ResourceScope) => reading(queryClient.fetchQuery(getServiceTypesOptions({ path: { dealershipId } })))

  async function records(resource: string, scope: ResourceScope): Promise<{ rows: BaseRecord[]; day: WorkshopScheduleResponse }> {
    switch (resource) {
      case "technicians": {
        const day = await schedule(scope)
        return { rows: technicianRecords(day), day }
      }
      case "bays": {
        const day = await schedule(scope)
        return { rows: bayRecords(day), day }
      }
      case "services": {
        const [services, day] = await Promise.all([catalogue(scope), schedule(scope)])
        return { rows: serviceRecords(services, day), day }
      }
      default:
        throw refusal(404, `There is no resource called ${resource}.`)
    }
  }

  const find = async (resource: string, id: BaseKey, meta: MetaQuery | undefined) => {
    const { rows } = await records(resource, scopeOf(meta))
    const record = rows.find((row) => String(row.id) === String(id))
    if (!record) throw refusal(404, `No ${resource} record with id ${id} at this dealership.`)
    return record
  }

  const readOnly = (resource: string) => Promise.reject(refusal(405, `The ${resource} list is read-only.`))

  return {
    getList: async <TData extends BaseRecord = BaseRecord>({ resource, meta, pagination, filters, sorters }: Parameters<DataProvider["getList"]>[0]) => {
      refuseServerQueries(filters, sorters)
      const { rows, day } = await records(resource, scopeOf(meta))
      const response: ResourceListResponse<TData> = {
        data: paged(rows, pagination) as TData[],
        total: rows.length,
        day: { date: day.date, operatingWindow: day.operatingWindow },
      }
      return response
    },
    getOne: async <TData extends BaseRecord = BaseRecord>({ resource, id, meta }: Parameters<DataProvider["getOne"]>[0]) => ({
      data: (await find(resource, id, meta)) as TData,
    }),
    getMany: async <TData extends BaseRecord = BaseRecord>({ resource, ids, meta }: Parameters<NonNullable<DataProvider["getMany"]>>[0]) => {
      const { rows } = await records(resource, scopeOf(meta))
      const byId = new Map(rows.map((row) => [String(row.id), row]))
      return { data: ids.flatMap((id) => byId.get(String(id)) ?? []) as TData[] }
    },
    create: ({ resource }) => readOnly(resource),
    update: ({ resource }) => readOnly(resource),
    deleteOne: ({ resource }) => readOnly(resource),
    // The generated client owns the URLs (same origin unless a build sets VITE_API_BASE_URL); Refine never builds one.
    getApiUrl: () => "",
  }
}
