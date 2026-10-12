import { describe, expect, it } from "vitest"

import { capabilitiesOf, identityKey, identitySource, knownRoles, LOGIN_PATH, nameOf, safeReturnTo, signInHref } from "@/lib/session"
import { admin, anonymous, noRole, serviceAdvisor, unnamedAdvisor, viewer } from "@/test/identities"

describe("what each caller may do", () => {
  it.each([
    ["anonymous", anonymous, { canWrite: false, canViewDetails: false, canOpenResources: false, isAdmin: false }],
    ["a signed-in account without a role", noRole, { canWrite: false, canViewDetails: false, canOpenResources: false, isAdmin: false }],
    ["a Viewer", viewer, { canWrite: false, canViewDetails: true, canOpenResources: true, isAdmin: false }],
    ["a Service advisor", serviceAdvisor, { canWrite: true, canViewDetails: true, canOpenResources: true, isAdmin: false }],
    ["an Admin", admin, { canWrite: true, canViewDetails: true, canOpenResources: true, isAdmin: true }],
  ])("mirrors the API's policies for %s", (_, user, expected) => {
    expect(capabilitiesOf(user)).toEqual(expected)
  })

  it("allows nothing before /me answers", () => {
    expect(capabilitiesOf(undefined)).toEqual({ canWrite: false, canViewDetails: false, canOpenResources: false, isAdmin: false })
  })

  it("grants nothing for roles an anonymous answer lists or the app does not know", () => {
    expect(capabilitiesOf({ ...anonymous, roles: ["Admin"] }).canWrite).toBe(false)
    expect(knownRoles(["Owner", "Viewer", "Admin"])).toEqual(["Admin", "Viewer"])
  })
})

describe("the signed-in name", () => {
  it("is the token's name, else the email", () => {
    expect(nameOf(serviceAdvisor)).toBe("Sam Advisor")
    expect(nameOf(unnamedAdvisor)).toBe("advisor@keyloop.test")
  })
})

describe("the identity's fingerprint", () => {
  it("changes with sign-in, the email or the roles, and with nothing else", () => {
    expect(identityKey(admin)).not.toBe(identityKey(anonymous))
    expect(identityKey(serviceAdvisor)).not.toBe(identityKey({ ...serviceAdvisor, email: "other@keyloop.test" }))
    expect(identityKey(serviceAdvisor)).not.toBe(identityKey({ ...serviceAdvisor, roles: ["Viewer"] }))
    expect(identityKey(serviceAdvisor)).toBe(identityKey({ ...serviceAdvisor, displayName: "Sam A.", loginUrl: "/auth/login" }))
    expect(identityKey({ ...admin, roles: ["Admin", "Viewer"] })).toBe(identityKey({ ...admin, roles: ["Viewer", "Admin"] }))
  })
})

describe("the sign-in address", () => {
  it("returns to the page the user is on, its dealership and day included", () => {
    const href = signInHref("/dispatch?dealership=45fa64a1-baa9-8c61-b11a-ee9d7572ae3e&date=2026-10-14")

    expect(href).toBe("/auth/login?returnTo=%2Fdispatch%3Fdealership%3D45fa64a1-baa9-8c61-b11a-ee9d7572ae3e%26date%3D2026-10-14")
    const returnTo = new URL(href, window.location.origin).searchParams.get("returnTo")
    expect(returnTo).toBe("/dispatch?dealership=45fa64a1-baa9-8c61-b11a-ee9d7572ae3e&date=2026-10-14")
  })

  it("is always the API's own login path on this origin, whatever else was offered", () => {
    expect(LOGIN_PATH).toBe("/auth/login")
    const href = signInHref("/resources/bays")
    expect(href).toBe("/auth/login?returnTo=%2Fresources%2Fbays")
    expect(new URL(href, window.location.origin).origin).toBe(window.location.origin)
  })

  it.each([
    ["a protocol-relative address", "//evil.example/steal"],
    ["a backslash after the slash", "/\\evil.example/steal"],
    ["a backslash further on", "/dispatch\\..\\evil"],
    ["a leading backslash", "\\evil.example"],
    ["an absolute URL", "https://evil.example/"],
    ["a script URL", "javascript:alert(1)"],
    ["a relative path", "dispatch?date=2026-10-14"],
    ["a leading space", " /dispatch"],
    ["nothing", ""],
    ["a NUL", "/dispatch\u0000evil"],
    ["a tab before another slash", "/\t/evil.example"],
    ["a line break", "/dispatch\nSet-Cookie: x=1"],
    ["DEL", "/dispatch\u007f"],
    ["a C1 control", "/dispatch\u0085"],
    ["a lone surrogate", "/dispatch\ud800"],
  ])("returns to / instead of %s", (_, returnTo) => {
    expect(safeReturnTo(returnTo)).toBe("/")
    expect(signInHref(returnTo)).toBe("/auth/login?returnTo=%2F")
  })

  it("keeps a local path with an encoded slash, a scheme-like segment or a non-Latin letter as it is", () => {
    for (const path of ["/dispatch?q=%2F%2Fx", "/notes/https:/x", "/dispatch?dealership=M\u00fcnchen", "/emoji/\ud83d\ude97"]) {
      expect(safeReturnTo(path)).toBe(path)
      expect(new URL(signInHref(path), window.location.origin).searchParams.get("returnTo")).toBe(path)
    }
  })
})

describe("where the identity comes from", () => {
  it("is Cloudflare Access outside the development dev server", () => {
    expect(identitySource()).toBe("access")
  })
})
