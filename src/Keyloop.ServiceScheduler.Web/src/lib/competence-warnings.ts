import type { CompetenceWarningResponse } from "@/api/types.gen"

export type CompetenceReason = CompetenceWarningResponse["reasonCodes"][number]

export interface WarningContext {
  technician: string
  bay: string
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

export const COMPETENCE_REASONS = Object.keys(competenceReasons) as CompetenceReason[]

/** Formats a competence warning reason code into user-facing text. */
export function competenceReason(code: string, context: WarningContext): string {
  const explain = (competenceReasons as Record<string, (context: WarningContext) => string>)[code]
  return explain ? explain(context) : `Something this job needs changed (${code}).`
}

export const NEEDS_REVIEW = "Needs review"

/** Returns `warning` only when `canSee` is true and the warning requires review. */
export function shownWarning(
  warning: CompetenceWarningResponse | null | undefined,
  canSee: boolean
): CompetenceWarningResponse | null {
  return canSee && warning?.requiresReview && warning.reasonCodes.length > 0 ? warning : null
}

/** Determines whether the warning affects the technician, the bay, or both. */
export function warningSubject(warning: CompetenceWarningResponse): "technician" | "bay" | "both" {
  const technician = warning.reasonCodes.some((code) => code.startsWith("technician-"))
  const bay = warning.reasonCodes.some((code) => code.startsWith("bay-"))
  return technician && bay ? "both" : bay ? "bay" : "technician"
}

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
