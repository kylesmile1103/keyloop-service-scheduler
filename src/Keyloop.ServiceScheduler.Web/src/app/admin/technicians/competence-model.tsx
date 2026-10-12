import type { ColumnDef } from "@tanstack/react-table"

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import type { DataTableFeatures } from "@/lib/data-table"
import { type HvLevel, hvLevelOf, hvLevels } from "@/lib/vehicle-aware"

import { facetFilter } from "../lib/columns"
import type { TechnicianRecord } from "../lib/resources"
import { BrandsCell, CompetenceCell } from "./competence"

/**
 * A technician's high-voltage competence (ADR-029 Phase 0), read-only until editing arrives (Task 30): the level with its
 * IMI-style name, how long it is valid (an inclusive date in the dealership's calendar), whether a person confirmed it
 * (a level carried over by the migration is unconfirmed and needs review, yet still counts when booking), whether it has
 * expired (from today it counts as no HV training), and the brands the technician specialises in, which allocation does
 * not use yet. The schedule carries these to a role with vehicle-aware requirements on; otherwise there is nothing to show.
 */
export interface Competence {
  level: HvLevel
  /** `yyyy-MM-dd`, inclusive; `null` when the level does not expire. */
  validUntil: string | null
  confirmed: boolean
  /** Its last valid day is before today: from today it counts as level 0. */
  expired: boolean
  brands: string[]
}

/** The competence a row carries, or `null` when the schedule did not send it. */
export function competenceOf(row: TechnicianRecord, today: string): Competence | null {
  const level = hvLevelOf(row.hvLevel)
  if (level === null) return null
  const validUntil = row.hvLevelValidUntil ?? null
  return {
    level,
    validUntil,
    confirmed: row.hvLevelConfirmed !== false,
    expired: validUntil !== null && validUntil < today,
    brands: row.brandSpecialisms ?? [],
  }
}

/** The competence facet's choices: each level, then the two states that need a look. */
export const COMPETENCE_CHOICES = [
  ...([0, 1, 2, 3, 4] as const).map((level) => ({ value: `level-${level}`, label: level === 0 ? "No HV training" : `Level ${level}: ${hvLevels[level].name}` })),
  { value: "unconfirmed", label: "Unconfirmed, needs review" },
  { value: "expired", label: "Expired" },
]

function competenceValues(row: TechnicianRecord, today: string): string[] {
  const competence = competenceOf(row, today)
  if (!competence) return []
  return [`level-${competence.level}`, ...(competence.confirmed ? [] : ["unconfirmed"]), ...(competence.expired ? ["expired"] : [])]
}

/**
 * The roster's competence columns, for `today` (whether a level has expired is a question about the dealership's date):
 * the HV level (sortable, highest first when descending; an expired level sorts as none) and the brand specialisms.
 */
export function competenceColumns(today: string): ColumnDef<DataTableFeatures, TechnicianRecord>[] {
  return [
    {
      id: "hv",
      accessorFn: (row) => {
        const competence = competenceOf(row, today)
        return competence ? (competence.expired ? 0 : competence.level) : -1
      },
      header: ({ column }) => <DataTableColumnHeader column={column} title="HV competence" />,
      cell: ({ row }) => <CompetenceCell competence={competenceOf(row.original, today)} />,
      getUniqueValues: (row) => competenceValues(row, today),
      filterFn: facetFilter((row) => competenceValues(row, today)),
      sortFn: "basic",
      meta: { label: "HV competence" },
    },
    {
      id: "brands",
      accessorFn: (row) => (row.brandSpecialisms ?? []).join(" "),
      header: () => (
        <span className="flex flex-col text-xs font-medium text-muted-foreground">
          <span>Brands</span>
          <span className="text-2xs font-normal">not used for allocation yet</span>
        </span>
      ),
      cell: ({ row }) => <BrandsCell competence={competenceOf(row.original, today)} />,
      enableSorting: false,
      meta: { label: "Brands" },
    },
  ]
}
