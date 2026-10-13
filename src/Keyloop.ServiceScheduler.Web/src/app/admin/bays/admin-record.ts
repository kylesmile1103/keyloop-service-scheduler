import type { AdminBayResponse } from "@/api/types.gen"

import type { BayRecord } from "../lib/resources"

/** A row of the Admin's bay list as the Admin read it, with its version; `null` for a list without versions. */
export function adminBayOf(row: BayRecord): AdminBayResponse | null {
  return typeof row.version === "number" ? { id: row.id, dealershipId: "", name: row.name, capabilities: row.capabilities, isActive: row.isActive, version: row.version } : null
}
