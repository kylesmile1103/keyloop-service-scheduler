import { describe, expect, it } from "vitest"

import { serviceHelp } from "./service-help"

describe("help copy for services whose name alone could mislead", () => {
  it("says the accident damage assessment inspects and estimates, and does not repair", () => {
    expect(serviceHelp("ACCIDENT-DAMAGE-ASSESSMENT")).toBe("Inspection and estimate of collision damage, not the repair itself.")
  })

  it("adds nothing to a service whose name says what it is", () => {
    expect(serviceHelp("BRAKES-PADS-DISCS")).toBeNull()
    expect(serviceHelp(undefined)).toBeNull()
    // Only the catalogue's own codes, never an inherited property of the lookup table.
    expect(serviceHelp("toString")).toBeNull()
  })
})
