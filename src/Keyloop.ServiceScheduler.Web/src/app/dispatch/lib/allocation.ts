import type { AllocationDecision, AppointmentResponse, ServiceTypeResponse, WorkshopScheduleResponse } from "@/api/types.gen"
import { formatDay } from "@/lib/calendar-date"
import { type AllocationExplanation, explainAllocation, whyNot } from "@/lib/vehicle-aware"

/** The roster the explanation names resources from: the board's schedule for the day (names, and levels for a role). */
export type Roster = Pick<WorkshopScheduleResponse, "bays" | "technicians">

/**
 * Why each preference the advisor gave was not followed (`reasons[]`), naming the bay or technician from the roster and,
 * for a level the job needed, the technician's own level and expiry when the roster carries them.
 */
export function whyNotLines(allocation: AllocationDecision, roster: Roster | undefined): string[] {
  const bay = roster?.bays.find((candidate) => candidate.id === allocation.preferredBayId)
  const technician = roster?.technicians.find((candidate) => candidate.id === allocation.preferredTechnicianId)
  return allocation.reasons.map((code) =>
    whyNot(code, {
      bay: bay?.name ?? null,
      technician: technician?.name ?? null,
      technicianLevel: technician ? { level: technician.hvLevel ?? null, validUntil: technician.hvLevelValidUntil ?? null } : undefined,
      minimumHvLevel: allocation.minimumHvLevel,
      formatDate: (date) => formatDay(date, "long"),
    })
  )
}

/** A booking's allocation, explained: the sentence for the technician and the bay, and why a preference was not followed. */
export function explainBooking(
  appointment: AppointmentResponse,
  allocation: AllocationDecision,
  service: Pick<ServiceTypeResponse, "requiredCertifications" | "requiredBayCapabilities"> | undefined,
  roster: Roster | undefined
): AllocationExplanation & { whyNot: string[] } {
  return {
    ...explainAllocation({
      allocation,
      technician: appointment.technician.name,
      bay: appointment.bay.name,
      service,
      profile: appointment.vehicle.profile,
    }),
    whyNot: whyNotLines(allocation, roster),
  }
}
