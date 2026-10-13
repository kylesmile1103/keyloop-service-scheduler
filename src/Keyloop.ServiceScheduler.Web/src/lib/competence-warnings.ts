import type { CompetenceWarningResponse } from "@/api/types.gen"

/**
 * Competence warnings (ADR-029, Task 30a item 5): an appointment still holding its bay and technician (confirmed, checked
 * in or in progress) whose technician or bay no longer meets what the booking required, on the appointment's own local
 * date. The API computes them on the schedule and detail reads for a workshop role with vehicle-aware requirements on, and
 * omits them for a visitor, for a clean appointment and with the switch off. Nothing is moved or rebooked: the flag asks a
 * person to look (ADR-029: reassignment is a human decision). One catalogue of words, keyed by the API's own reason codes,
 * so a code the contract adds is a compile error here and a failing test.
 */

export type CompetenceReason = CompetenceWarningResponse["reasonCodes"][number]

/** Who the reasons are about: the appointment's technician and bay, by name, and its local date. */
export interface WarningContext {
  technician: string
  bay: string
  /** "Tuesday 13 October 2026": the appointment's local date in words. */
  day: string
}

export const competenceReasons: Record<CompetenceReason, (context: WarningContext) => string> = {
  "technician-inactive": ({ technician }) => `${technician} has been deactivated and takes no bookings.`,
  "technician-certification-removed": ({ technician }) => `${technician} no longer holds a certification this job needs.`,
  "technician-hv-expired": ({ technician, day }) => `${technician}'s HV level is no longer valid on ${day}.`,
  "technician-hv-level-lowered": ({ technician }) => `${technician}'s HV level is now below the level this job needs.`,
  "bay-inactive": ({ bay }) => `${bay} is out of service.`,
  "bay-capability-removed": ({ bay }) => `${bay} no longer has equipment this job needs.`,
}

/** Every reason code the catalogue words (for the completeness test). */
export const COMPETENCE_REASONS = Object.keys(competenceReasons) as CompetenceReason[]

/** A reason in words; a code the catalogue does not know yet is still said. */
export function competenceReason(code: string, context: WarningContext): string {
  const explain = (competenceReasons as Record<string, (context: WarningContext) => string>)[code]
  return explain ? explain(context) : `Something this job needs changed (${code}).`
}

/** The short form for a block, a card and a label: what to do, not why. */
export const NEEDS_REVIEW = "Needs review"

/**
 * The warning to show, if any: one that asks for review, and only to a signed-in workshop role. The API never sends one to
 * anybody else; the check keeps a cached answer from showing it to the next caller before the views read again.
 */
export function shownWarning(
  warning: CompetenceWarningResponse | null | undefined,
  canSee: boolean
): CompetenceWarningResponse | null {
  return canSee && warning?.requiresReview && warning.reasonCodes.length > 0 ? warning : null
}

/** Which side the warning is about, for the words that sum it up: the technician, the bay, or both. */
export function warningSubject(warning: CompetenceWarningResponse): "technician" | "bay" | "both" {
  const technician = warning.reasonCodes.some((code) => code.startsWith("technician-"))
  const bay = warning.reasonCodes.some((code) => code.startsWith("bay-"))
  return technician && bay ? "both" : bay ? "bay" : "technician"
}

/** "Its technician no longer qualifies", for a tooltip or a summary line. */
export function warningSummary(warning: CompetenceWarningResponse): string {
  switch (warningSubject(warning)) {
    case "both":
      return "Its technician and bay no longer qualify"
    case "bay":
      return "Its bay no longer qualifies"
    default:
      return "Its technician no longer qualifies"
  }
}
