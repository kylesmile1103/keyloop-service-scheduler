/**
 * One line of help for a catalogue service whose name alone could mislead, by its stable code. Client-owned copy: the
 * catalogue has no description field, and none of this comes from a model. Shown wherever the booking dialog describes a
 * service (the Service list, the chosen service, a suggested service's card).
 */
const help: Readonly<Record<string, string>> = {
  // Task 32a: the assessment inspects and prices the damage; the repair is booked or arranged separately.
  "ACCIDENT-DAMAGE-ASSESSMENT": "Inspection and estimate of collision damage, not the repair itself.",
}

/** The help line for a service code, or `null` when its name says enough. */
export function serviceHelp(code: string | undefined): string | null {
  return code !== undefined && Object.hasOwn(help, code) ? help[code] : null
}
