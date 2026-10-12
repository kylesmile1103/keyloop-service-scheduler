import { Route } from "lucide-react"
import { useId } from "react"

import type { AllocationDecision, AppointmentResponse, ServiceTypeResponse } from "@/api/types.gen"
import { HvLevelBadge } from "@/components/hv-level"
import { ProvenanceChip } from "@/components/provenance-chip"
import { cn } from "@/lib/utils"
import { hvLevelOf, knownManufacturer, LIVE_DIAGNOSIS_RULE, powertrainLabels, vehicleClassLabels } from "@/lib/vehicle-aware"

import { explainBooking, type Roster } from "../lib/allocation"
import { TwoPersonWarning } from "./vehicle-step"

interface AllocationExplanationViewProps {
  appointment: AppointmentResponse
  allocation: AllocationDecision
  /** The service's own needs (the catalogue's), for the skills the sentence names. */
  service: Pick<ServiceTypeResponse, "requiredCertifications" | "requiredBayCapabilities"> | undefined
  roster: Roster | undefined
  /** The vehicle's profile and its declaration (who and why): the details sheet shows it, the booked state does not. */
  showProfile?: boolean
  className?: string
}

/**
 * "Why this allocation" (ADR-029 §4): one sentence for the technician in the ADR's style ("Ben Okafor: the only free
 * technician at HV level 3 or above with Diagnostics, for a battery-electric vehicle (declared)"), one for the bay, the HV
 * level the job needed and the rules that set it, and why a preferred bay or technician was not chosen. Private: it comes
 * from the role-protected record or the booking's own answer, never from the public schedule.
 */
export function AllocationExplanationView({ appointment, allocation, service, roster, showProfile = false, className }: AllocationExplanationViewProps) {
  const headingId = useId()
  const explained = explainBooking(appointment, allocation, service, roster)
  const level = hvLevelOf(allocation.minimumHvLevel)
  const live = allocation.firedRules.includes(LIVE_DIAGNOSIS_RULE)
  const profile = appointment.vehicle.profile

  return (
    <section
      aria-labelledby={headingId}
      data-slot="allocation-explanation"
      className={cn("flex flex-col gap-3 rounded-xl border border-border p-3 text-sm", className)}
    >
      <h3 id={headingId} className="flex items-center gap-2 font-heading text-sm font-semibold">
        <Route aria-hidden="true" className="size-4 text-muted-foreground" />
        Why this allocation
      </h3>
      <div className="flex flex-col gap-1.5 text-pretty">
        <p>{explained.technician}</p>
        <p className="text-muted-foreground">{explained.bay}</p>
      </div>
      {(level !== null && level > 0) || explained.because.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {level !== null && level > 0 && (
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              The job needed
              <HvLevelBadge level={level} named className="text-foreground" />
            </span>
          )}
          {explained.because.length > 0 && (
            <ul aria-label="Because" className="flex list-disc flex-col gap-0.5 pl-5 text-xs text-pretty text-muted-foreground">
              {explained.because.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {explained.whyNot.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold">Not as you asked</p>
          <ul className="flex flex-col gap-0.5 text-pretty">
            {explained.whyNot.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {live && <TwoPersonWarning />}
      {showProfile && profile && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <p className="text-xs font-semibold">Vehicle as booked</p>
          <dl className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Powertrain</dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              {profile.powertrain === "Unknown" ? "Unknown, planned as high-voltage" : powertrainLabels[profile.powertrain]}
              <ProvenanceChip source={profile.provenance.powertrain} />
            </dd>
            <dt className="text-muted-foreground">Manufacturer</dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              {knownManufacturer(profile.manufacturer) ? (
                <span className="font-mono text-xs font-medium tracking-wide">{profile.manufacturer}</span>
              ) : (
                "Unknown"
              )}
              <ProvenanceChip source={profile.provenance.manufacturer} />
            </dd>
            <dt className="text-muted-foreground">Class</dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              {profile.vehicleClass === "Unknown" ? "Unknown" : vehicleClassLabels[profile.vehicleClass]}
              <ProvenanceChip source={profile.provenance.vehicleClass} />
            </dd>
          </dl>
          {profile.provenance.declaredBy && (
            <p className="text-xs text-pretty text-muted-foreground">
              {`Declared by ${profile.provenance.declaredBy}`}
              {profile.provenance.declarationReason ? `: “${profile.provenance.declarationReason}”` : ""}
            </p>
          )}
        </div>
      )}
      <p className="text-2xs text-muted-foreground tabular-nums">{`Policy version ${allocation.policyVersion}. Shown only to signed-in workshop roles.`}</p>
    </section>
  )
}
