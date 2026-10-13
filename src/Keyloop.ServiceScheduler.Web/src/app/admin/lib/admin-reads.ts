import type { QueryFunctionContext } from "@tanstack/react-query"

import { getAdminBay, getAdminHistory, getAdminTechnician, getRequirementPolicy, listAdminBays, listAdminTechnicians } from "./admin-request"
import type { GetAdminHistoryData } from "@/api/types.gen"

/**
 * The Admin reads (Task 30a) as TanStack query options, built here over the generated SDK functions rather than taken from
 * the generated `@tanstack/react-query.gen` module. That module is shared with the dispatch board, and a module goes into
 * one chunk with every export any page uses: taking the Admin options from it would put them in the board's first load.
 * The SDK functions already sit in a shared chunk the board loads; the options built here stay in the admin area's code.
 *
 * The keys keep the generated keys' shape (`[{ _id, path, query }]`, the operation id as `_id`), so the cache hygiene of a
 * change of identity (`lib/session-cache.ts`: every key but the caller-independent reads is cleared) and the refresh after
 * an edit (`lib/refresh.ts`, by operation id and dealership) treat them as they treat the generated ones.
 */

type HistoryQuery = NonNullable<GetAdminHistoryData["query"]>

const key = <TPath extends object, TQuery extends object | undefined = undefined>(id: string, path: TPath, query?: TQuery) =>
  [{ _id: id, path, ...(query ? { query } : {}) }] as const

export const adminTechniciansQuery = (dealershipId: string) => ({
  queryKey: key("listAdminTechnicians", { dealershipId }),
  queryFn: async ({ signal }: QueryFunctionContext) => (await listAdminTechnicians({ path: { dealershipId }, signal, throwOnError: true })).data,
})

export const adminTechnicianQuery = (dealershipId: string, technicianId: string) => ({
  queryKey: key("getAdminTechnician", { dealershipId, technicianId }),
  queryFn: async ({ signal }: QueryFunctionContext) => (await getAdminTechnician({ path: { dealershipId, technicianId }, signal, throwOnError: true })).data,
})

export const adminBaysQuery = (dealershipId: string) => ({
  queryKey: key("listAdminBays", { dealershipId }),
  queryFn: async ({ signal }: QueryFunctionContext) => (await listAdminBays({ path: { dealershipId }, signal, throwOnError: true })).data,
})

export const adminBayQuery = (dealershipId: string, bayId: string) => ({
  queryKey: key("getAdminBay", { dealershipId, bayId }),
  queryFn: async ({ signal }: QueryFunctionContext) => (await getAdminBay({ path: { dealershipId, bayId }, signal, throwOnError: true })).data,
})

export const requirementPolicyQuery = (dealershipId: string) => ({
  queryKey: key("getRequirementPolicy", { dealershipId }),
  queryFn: async ({ signal }: QueryFunctionContext) => (await getRequirementPolicy({ path: { dealershipId }, signal, throwOnError: true })).data,
})

/** The change history a page at a time (`offset`, `limit`), newest first; `nextOffset` says where the next page starts. */
export const adminHistoryPages = (dealershipId: string, query: Omit<HistoryQuery, "offset">) => ({
  queryKey: key("getAdminHistory", { dealershipId }, { ...query, infinite: true }),
  queryFn: async ({ pageParam, signal }: QueryFunctionContext<readonly unknown[], number>) =>
    (await getAdminHistory({ path: { dealershipId }, query: { ...query, offset: pageParam }, signal, throwOnError: true })).data,
  initialPageParam: 0,
  getNextPageParam: (last: { nextOffset: number | null }) => last.nextOffset ?? undefined,
})
