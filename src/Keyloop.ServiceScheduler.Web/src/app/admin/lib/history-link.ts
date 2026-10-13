import { DEALERSHIP_PARAM } from "@/lib/workshop-params"

/** The change history's address (`/resources/history`), for one dealership and, when given, one technician's, bay's or the policy's changes. */
export function historyHref(dealershipId: string, kind?: "technician" | "bay" | "policy", resourceId?: string): string {
  const search = new URLSearchParams({ [DEALERSHIP_PARAM]: dealershipId })
  if (kind) search.set("kind", kind)
  if (kind && resourceId) search.set("resource", resourceId)
  return `/resources/history?${search}`
}
