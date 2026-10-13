/** Clarifying help copy keyed by service catalogue code. */
const help: Readonly<Record<string, string>> = {
  "ACCIDENT-DAMAGE-ASSESSMENT": "Inspection and estimate of collision damage, not the repair itself.",
}

export function serviceHelp(code: string | undefined): string | null {
  return code !== undefined && Object.hasOwn(help, code) ? help[code] : null
}
