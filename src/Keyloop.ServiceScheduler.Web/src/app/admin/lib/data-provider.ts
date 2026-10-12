import type { BaseKey, BaseRecord, CrudFilter, CrudSort, DataProvider, GetListResponse, MetaQuery, Pagination } from "@refinedev/core"
import type { QueryClient } from "@tanstack/react-query"

import {
  getAdminBayOptions,
  getAdminTechnicianOptions,
  getServiceTypesOptions,
  getWorkshopScheduleOptions,
  listAdminBaysOptions,
  listAdminTechniciansOptions,
} from "@/api/@tanstack/react-query.gen"
import type { BayWriteRequest, OperatingWindowResponse, TechnicianWriteRequest, WorkshopScheduleResponse } from "@/api/types.gen"

import { saveBay, saveTechnician } from "./admin-api"
import { refusal, toHttpError } from "./http-error"
import { adminBayRecords, adminTechnicianRecords, bayRecords, serviceRecords, technicianRecords } from "./resources"

/** The resources the admin area lists: technicians and bays are editable by an Admin (Task 30b), services read-only. */
export const RESOURCE_NAMES = ["technicians", "bays", "services"] as const

export type ResourceName = (typeof RESOURCE_NAMES)[number]

/**
 * Whose view of the lists: `workshop` (any role: the day's schedule, as the board reads it) or `admin` (an Admin, Task
 * 30b: the Admin reads, each record with its version for an edit's `If-Match`, the day's work still from the schedule).
 */
export type ResourceView = "workshop" | "admin"

/** What every list is about: one dealership's resources, measured on one of its days (today on the resources pages). */
export interface ResourceScope {
  dealershipId: string
  /** The dealership's calendar date, `yyyy-MM-dd`. */
  date: string
  view: ResourceView
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
  return { dealershipId, date, view: meta?.view === "admin" ? "admin" : "workshop" }
}

/** An Admin's write: the dealership, the bound write's fetch (never the page's own) and, for an edit, its `If-Match`. */
function writeOf(meta: MetaQuery | undefined): { dealershipId: string; fetch: typeof fetch; ifMatch?: string } {
  const dealershipId = meta?.dealershipId
  const bound = meta?.fetch
  if (typeof dealershipId !== "string") throw refusal(400, "An edit needs the dealership id in meta.")
  if (typeof bound !== "function") {
    throw refusal(400, "An edit is sent only through a write bound to the Admin who made it: pass the bound write's fetch in meta.")
  }
  return { dealershipId, fetch: bound as typeof fetch, ifMatch: typeof meta?.ifMatch === "string" ? meta.ifMatch : undefined }
}

/** Why a resource cannot be deleted, or edited at all. */
const DELETE_REFUSALS: Record<string, string> = {
  technicians: "Technicians are never deleted: deactivate one instead, so its appointments and history stay.",
  bays: "Bays are never deleted: take one out of service instead, so its appointments and history stay.",
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
 * The Refine data provider over the generated HeyAPI client, for the resources pages (ARCHITECTURE §15, ADR-031).
 *
 * The API has no generic REST resources. For any role, technicians and bays come from the day's schedule read
 * (`GET /schedule`) and services from the catalogue (`GET /service-types`), through the app's own QueryClient with the
 * generated query options, so they share the dispatch board's cache entries (one cache, one request for the same day). For
 * an Admin (`meta.view: "admin"`, Task 30b) technicians and bays come from the Admin reads, each with the version an edit
 * is sent against, merged with the same day's work from the schedule; one record (`getOne`, the edit form's) is read fresh.
 * Every failure becomes Refine's `HttpError` with the API's status, words, trace id and field errors.
 *
 * Writes (Task 30b): `create` and `update` add or replace a technician or a bay through the Admin API, only with the fetch
 * of a write bound to the Admin who made it (`meta.fetch`, from `useWriteMutation` with `writes: "admin"`; without one
 * nothing is sent) and, for an edit, the version it was made from (`meta.ifMatch`). Nothing is deleted (`405`: a technician
 * is deactivated and a bay taken out of service, so appointments and history keep them) and services stay read-only.
 */
export function createSchedulerDataProvider(queryClient: QueryClient): DataProvider {
  const schedule = ({ dealershipId, date }: ResourceScope) =>
    reading(queryClient.fetchQuery(getWorkshopScheduleOptions({ path: { dealershipId }, query: { date } })))
  const catalogue = ({ dealershipId }: ResourceScope) => reading(queryClient.fetchQuery(getServiceTypesOptions({ path: { dealershipId } })))
  // Fresh every time: what an Admin edits must be what the API holds now.
  const adminTechnicians = ({ dealershipId }: ResourceScope) =>
    reading(queryClient.fetchQuery({ ...listAdminTechniciansOptions({ path: { dealershipId } }), staleTime: 0 }))
  const adminBays = ({ dealershipId }: ResourceScope) => reading(queryClient.fetchQuery({ ...listAdminBaysOptions({ path: { dealershipId } }), staleTime: 0 }))

  async function records(resource: string, scope: ResourceScope): Promise<{ rows: BaseRecord[]; day: WorkshopScheduleResponse }> {
    switch (resource) {
      case "technicians": {
        if (scope.view === "admin") {
          const [people, day] = await Promise.all([adminTechnicians(scope), schedule(scope)])
          return { rows: adminTechnicianRecords(people, day), day }
        }
        const day = await schedule(scope)
        return { rows: technicianRecords(day), day }
      }
      case "bays": {
        if (scope.view === "admin") {
          const [lanes, day] = await Promise.all([adminBays(scope), schedule(scope)])
          return { rows: adminBayRecords(lanes, day), day }
        }
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
    const scope = scopeOf(meta)
    // An Admin's form reads the one record, fresh, with its version (the representation an edit is made from).
    if (scope.view === "admin" && resource === "technicians") {
      return reading(queryClient.fetchQuery({ ...getAdminTechnicianOptions({ path: { dealershipId: scope.dealershipId, technicianId: String(id) } }), staleTime: 0 }))
    }
    if (scope.view === "admin" && resource === "bays") {
      return reading(queryClient.fetchQuery({ ...getAdminBayOptions({ path: { dealershipId: scope.dealershipId, bayId: String(id) } }), staleTime: 0 }))
    }
    const { rows } = await records(resource, scope)
    const record = rows.find((row) => String(row.id) === String(id))
    if (!record) throw refusal(404, `No ${resource} record with id ${id} at this dealership.`)
    return record
  }

  const readOnly = (resource: string) => Promise.reject(refusal(405, `The ${resource} list is read-only.`))

  /** Adds (`id` absent) or replaces a technician or a bay; anything else is read-only. */
  async function write(resource: string, id: BaseKey | undefined, variables: unknown, meta: MetaQuery | undefined): Promise<BaseRecord> {
    if (resource !== "technicians" && resource !== "bays") return readOnly(resource)
    const { dealershipId, fetch, ifMatch } = writeOf(meta)
    const target = id === undefined ? undefined : String(id)
    try {
      return resource === "technicians"
        ? await saveTechnician({ dealershipId, id: target, body: variables as TechnicianWriteRequest, ifMatch, fetch })
        : await saveBay({ dealershipId, id: target, body: variables as BayWriteRequest, ifMatch, fetch })
    } catch (error) {
      throw toHttpError(error)
    }
  }

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
    create: async <TData extends BaseRecord = BaseRecord>({ resource, variables, meta }: Parameters<DataProvider["create"]>[0]) => ({
      data: (await write(resource, undefined, variables, meta)) as TData,
    }),
    update: async <TData extends BaseRecord = BaseRecord>({ resource, id, variables, meta }: Parameters<DataProvider["update"]>[0]) => ({
      data: (await write(resource, id, variables, meta)) as TData,
    }),
    deleteOne: ({ resource }) => Promise.reject(refusal(405, DELETE_REFUSALS[resource] ?? `The ${resource} list is read-only.`)),
    // The generated client owns the URLs (same origin unless a build sets VITE_API_BASE_URL); Refine never builds one.
    getApiUrl: () => "",
  }
}
