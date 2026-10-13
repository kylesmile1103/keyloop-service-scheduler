import type {
  AdminBayResponse,
  AdminTechnicianResponse,
  BayCapability,
  BayWriteRequest,
  Certification,
  TechnicianWriteRequest,
} from "@/api/types.gen"
import { formatDay } from "@/lib/calendar-date"
import { bayCapabilities, certifications } from "@/lib/features"

/**
 * A technician's or a bay's state, field by field, in the screen's words: what a conflict (`412`) and the change history
 * compare. Each field has its label and its value in words, so "HV level: HV 3 → HV 2" reads the same everywhere.
 */

export interface FieldWords<T> {
  key: keyof T & string
  label: string
  words: (value: never) => string
}

const list = (values: readonly string[], none = "None") => (values.length > 0 ? values.join(", ") : none)
const hv = (level: number) => (level === 0 ? "No HV" : `HV ${level}`)

const certificationNames = (values: readonly Certification[]) => list(values.map((value) => certifications[value]?.label ?? value))
const capabilityNames = (values: readonly BayCapability[]) => list(values.map((value) => bayCapabilities[value]?.label ?? value))

export const technicianFields: Array<FieldWords<TechnicianWriteRequest>> = [
  { key: "name", label: "Name", words: (value: string) => value },
  { key: "employeeNumber", label: "Employee number", words: (value: string) => value },
  { key: "certifications", label: "Certified for", words: certificationNames },
  { key: "isActive", label: "Bookings", words: (value: boolean) => (value ? "Active" : "Inactive") },
  { key: "hvLevel", label: "HV level", words: hv },
  { key: "hvLevelValidUntil", label: "Valid until", words: (value: string | null) => (value ? formatDay(value, "dated") : "Does not expire") },
  { key: "hvLevelConfirmed", label: "Level confirmed", words: (value: boolean) => (value ? "Confirmed" : "Unconfirmed") },
  { key: "brandSpecialisms", label: "Brand specialisms", words: (value: string[]) => list(value) },
]

export const bayFields: Array<FieldWords<BayWriteRequest>> = [
  { key: "name", label: "Name", words: (value: string) => value },
  { key: "capabilities", label: "Equipment", words: capabilityNames },
  { key: "isActive", label: "Service", words: (value: boolean) => (value ? "In service" : "Out of service") },
]

/** A technician's whole write state, from the Admin representation. */
export function technicianWrite(record: AdminTechnicianResponse | TechnicianWriteRequest): TechnicianWriteRequest {
  return {
    name: record.name,
    employeeNumber: record.employeeNumber,
    certifications: [...record.certifications],
    isActive: record.isActive,
    hvLevel: record.hvLevel,
    hvLevelValidUntil: record.hvLevelValidUntil ?? null,
    hvLevelConfirmed: record.hvLevelConfirmed,
    brandSpecialisms: [...record.brandSpecialisms],
  }
}

/** A bay's whole write state, from the Admin representation. */
export function bayWrite(record: AdminBayResponse | BayWriteRequest): BayWriteRequest {
  return { name: record.name, capabilities: [...record.capabilities], isActive: record.isActive }
}

/** Two values of a field alike: lists compare as sets (the API keeps the enumeration's order; a form may not). */
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000")
  return a === b
}

/** One field that differs, in words. */
export interface FieldChange {
  key: string
  label: string
  before: string
  after: string
}

/** The fields that differ between two states, in the fields' order. */
export function changesBetween<T extends object>(fields: ReadonlyArray<FieldWords<T>>, before: T | null, after: T): FieldChange[] {
  return fields
    .filter((field) => !before || !same(before[field.key], after[field.key]))
    .map((field) => ({
      key: field.key,
      label: field.label,
      before: before ? field.words(before[field.key] as never) : "",
      after: field.words(after[field.key] as never),
    }))
}

/** A field in a conflict: as it was when the form opened, as it is now, and as this Admin had it. */
export interface ConflictRow {
  key: string
  label: string
  opened: string
  now: string
  /** `null` when this Admin left the field as it was opened. */
  yours: string | null
}

/**
 * A `412`'s comparison: every field that someone else changed since the form was opened, or that this Admin changed, with
 * the three values (opened, now, yours).
 */
export function conflictRows<T extends object>(fields: ReadonlyArray<FieldWords<T>>, opened: T, now: T, mine: T): ConflictRow[] {
  return fields
    .filter((field) => !same(opened[field.key], now[field.key]) || !same(opened[field.key], mine[field.key]))
    .map((field) => ({
      key: field.key,
      label: field.label,
      opened: field.words(opened[field.key] as never),
      now: field.words(now[field.key] as never),
      yours: same(opened[field.key], mine[field.key]) ? null : field.words(mine[field.key] as never),
    }))
}

/**
 * "Reapply my changes": the record as it is now, with every field this Admin changed (against what the form was opened
 * with) put back as this Admin had it. A field both changed takes this Admin's value: the Admin has just seen theirs.
 */
export function reapplied<T extends object>(fields: ReadonlyArray<FieldWords<T>>, opened: T, now: T, mine: T): T {
  const merged = { ...now }
  for (const field of fields) if (!same(opened[field.key], mine[field.key])) merged[field.key] = mine[field.key]
  return merged
}
