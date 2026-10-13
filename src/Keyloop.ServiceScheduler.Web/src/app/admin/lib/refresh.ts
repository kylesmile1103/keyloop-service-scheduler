import { type Query, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"

/** Query operations invalidated when an Admin saves a technician, bay, or policy change. */
const DEPENDS_ON_RESOURCES = new Set([
  "getWorkshopSchedule",
  "getServiceTypes",
  "getAvailability",
  "listAppointments",
  "listAdminTechnicians",
  "listAdminBays",
  "getAdminTechnician",
  "getAdminBay",
  "getRequirementPolicy",
  "getAdminHistory",
])

function staleAfterEdit(query: Query, dealershipId: string): boolean {
  const [first] = query.queryKey
  if (first === "data") return true
  if (typeof first !== "object" || first === null || !("_id" in first)) return false
  const id = (first as { _id: unknown })._id
  // A booking's record carries its warning; its path names the appointment, not the dealership.
  if (id === "getAppointment") return true
  const path = (first as { path?: { dealershipId?: unknown } }).path
  return typeof id === "string" && DEPENDS_ON_RESOURCES.has(id) && path?.dealershipId === dealershipId
}

/** Marks stale what an Admin's edit at a dealership changed (see above). */
export function useRefreshAfterEdit(): (dealershipId: string) => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback((dealershipId: string) => queryClient.invalidateQueries({ predicate: (query) => staleAfterEdit(query, dealershipId) }), [queryClient])
}
