import type { BookAppointmentRequest, Powertrain, VehicleClass, VehicleProfile } from "@/api/types.gen"
import { manufacturerCode } from "@/lib/vehicle-aware"

/**
 * What a "Use decoded data" choice is made for (ADR-029, `conflictChoice: UseDecoded`): the VIN, the attributes the advisor
 * declared, and the attributes a look-up of that VIN decoded. The choice holds for exactly these. When no look-up of the VIN
 * had answered (it failed, or the conflict came from the API before one did), the decoded attributes are unknown and the
 * choice holds for the VIN and the declaration: one VIN always decodes the same, so a later look-up of it only shows what
 * the choice already accepted.
 */
export interface DecodedChoice {
  /** As sent: trimmed and upper case. */
  vin: string
  declared: { powertrain: Powertrain; vehicleClass: VehicleClass; manufacturer: string }
  /** What a look-up of this VIN answered, or `null` when none had. */
  decoded: Pick<VehicleProfile, "powertrain" | "manufacturer" | "vehicleClass"> | null
}

/** The VIN as it is sent and compared. */
export const normalVin = (vin: string) => vin.trim().toUpperCase()

/** The decoded attributes of a look-up's answer, or `null` without one. */
export const decodedOf = (profile: VehicleProfile | null): DecodedChoice["decoded"] =>
  profile ? { powertrain: profile.powertrain, manufacturer: profile.manufacturer, vehicleClass: profile.vehicleClass } : null

/** The VIN and declaration a booking request carried (the one the API refused, for its conflict's choice). */
export function choiceOfRequest(body: BookAppointmentRequest, decoded: DecodedChoice["decoded"]): DecodedChoice {
  const profile = body.vehicle.profile
  return {
    vin: normalVin(body.vehicle.vin),
    declared: {
      powertrain: profile?.powertrain ?? "Unknown",
      vehicleClass: profile?.vehicleClass ?? "Unknown",
      manufacturer: manufacturerCode(profile?.manufacturer ?? ""),
    },
    decoded,
  }
}

/** The same VIN and the same declaration. */
export function sameEntry(a: DecodedChoice, b: DecodedChoice): boolean {
  return (
    a.vin === b.vin &&
    a.declared.powertrain === b.declared.powertrain &&
    a.declared.vehicleClass === b.declared.vehicleClass &&
    a.declared.manufacturer === b.declared.manufacturer
  )
}

/**
 * Whether a choice holds for what is entered (or sent) now: the same VIN and declaration, and the same decoded attributes
 * unless none were known when it was made.
 */
export function choiceHolds(choice: DecodedChoice | null, now: DecodedChoice): boolean {
  if (choice === null || !sameEntry(choice, now)) return false
  if (choice.decoded === null) return true
  return (
    now.decoded !== null &&
    choice.decoded.manufacturer === now.decoded.manufacturer &&
    choice.decoded.powertrain === now.decoded.powertrain &&
    choice.decoded.vehicleClass === now.decoded.vehicleClass
  )
}
