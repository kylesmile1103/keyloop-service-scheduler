import { Route } from "lucide-react"
import { useId } from "react"

import type { AllocationDecision, AppointmentResponse, ServiceTypeResponse } from "@/api/types.gen"
import { HvLevelBadge } from "@/components/hv-level"
import { ProvenanceChip } from "@/components/provenance-chip"
import { cn } from "@/lib/utils"
import { declarerName, hvLevelOf, knownManufacturer, LIVE_DIAGNOSIS_RULE, powertrainLabels, vehicleClassLabels } from "@/lib/vehicle-aware"

import { explainBooking, type Roster } from "../lib/allocation"
import { TwoPersonWarning } from "./vehicle-step"

interface AllocationExplanationViewProps {
  appointment: AppointmentResponse
  allocation: AllocationDecision
  /** Service catalogue requirements used to format the skill explanation. */
  service: Pick<ServiceTypeResponse, "requiredCertifications" | "requiredBayCapabilities"> | undefined
  roster: Roster | undefined
  /** Whether to include the vehicle profile and declaration provenance. */
  showProfile?: boolean
  /** Whether to render a bordered frame and heading around the explanation. */
  framed?: boolean
  className?: string
}

/** Displays why the technician and bay were allocated, required HV level, fired rules, and unmet preferences. */
export function AllocationExplanationView({
  appointment,
  allocation,
  service,
  roster,
  showProfile = false,
  framed = true,
  className,
}: AllocationExplanationViewProps) {
  const headingId = useId()
  const explained = explainBooking(appointment, allocation, service, roster)
  const level = hvLevelOf(allocation.minimumHvLevel)
  const live = allocation.firedRules.includes(LIVE_DIAGNOSIS_RULE)
  const profile = appointment.vehicle.profile

  return (
    <section
      aria-labelledby={framed ? headingId : undefined}
      aria-label={framed ? undefined : "Why this allocation"}
      data-slot="allocation-explanation"
      className={cn("flex flex-col gap-3 text-sm", framed && "rounded-xl border border-border p-3", className)}
    >
      {framed && (
        <h3 id={headingId} className="flex items-center gap-2 font-heading text-sm font-semibold">
          <Route aria-hidden="true" className="size-4 text-muted-foreground" />
          Why this allocation
        </h3>
      )}
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
          <dl
            className={cn(
              "grid items-center gap-x-3 gap-y-1.5 text-sm",
              // Inside the details' Job card its values line up with the card's own rows.
              framed ? "grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)]" : "grid-cols-[6rem_minmax(0,1fr)]"
            )}
          >
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
              {`Declared by ${declarerName(profile.provenance.declaredBy)}`}
              {profile.provenance.declarationReason ? `: “${profile.provenance.declarationReason}”` : ""}
            </p>
          )}
        </div>
      )}
      <p className="text-2xs text-muted-foreground tabular-nums">{`Policy version ${allocation.policyVersion}. Shown only to signed-in workshop roles.`}</p>
    </section>
  )
}
