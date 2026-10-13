import type { QueryFunctionContext } from "@tanstack/react-query"

import { getAdminBay, getAdminHistory, getAdminTechnician, getRequirementPolicy, listAdminBays, listAdminTechnicians } from "./admin-request"
import type { GetAdminHistoryData } from "@/api/types.gen"

/** TanStack Query options for Admin reads, kept in the admin chunk with query keys matching generated SDK shapes. */

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
