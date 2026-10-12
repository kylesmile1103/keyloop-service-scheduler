import type { AdminTechnicianResponse } from "@/api/types.gen"

import type { TechnicianRecord } from "../lib/resources"

/** A row of the Admin's list as the Admin read it: every field, with the version an edit is sent against. */
export function adminRecordOf(row: TechnicianRecord): (AdminTechnicianResponse & Pick<TechnicianRecord, "today">) | null {
  if (typeof row.version !== "number") return null
  return {
    ...row,
    dealershipId: "",
    hvLevel: row.hvLevel ?? 0,
    hvLevelValidUntil: row.hvLevelValidUntil ?? null,
    hvLevelConfirmed: row.hvLevelConfirmed ?? true,
    brandSpecialisms: row.brandSpecialisms ?? [],
    version: row.version,
  }
}
