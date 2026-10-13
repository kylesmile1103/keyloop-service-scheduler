import { describe, expect, it } from "vitest"

import * as sdk from "@/api/sdk.gen"
import { jsonResponse, mockApi } from "@/test/mock-api"

import * as admin from "./admin-request"

// The Admin operations are sent from the admin area's own code (so the board's first load never carries them), and must
// leave exactly as the generated SDK functions would send them: the same method, URL, headers and body.

const dealershipId = "45fa64a1-baa9-8c61-b11a-ee9d7572ae3e"
const technicianId = "82e5df3c-7917-88cc-a032-a7b56824ad2f"
const body = {
  name: "Ben Okafor",
  employeeNumber: "T-1002",
  certifications: ["GeneralService" as const],
  isActive: true,
  hvLevel: 3,
  hvLevelValidUntil: null,
  hvLevelConfirmed: true,
  brandSpecialisms: [],
}

/** The request each function sends, stripped of what differs per request (the request id). */
async function sent(call: () => Promise<unknown>) {
  const api = mockApi(() => jsonResponse({}))
  await call()
  const [request] = api.requests
  const headers = Object.fromEntries([...request.headers].filter(([name]) => name !== "x-request-id"))
  return { method: request.method, url: request.url, headers, body: request.body ? await request.clone().text() : null, requestId: request.headers.get("X-Request-Id") }
}

describe("the Admin operations, sent from the admin area", () => {
  it.each([
    ["editTechnician", { path: { dealershipId, technicianId }, body, headers: { "If-Match": '"722"' } }],
    ["createTechnician", { path: { dealershipId }, body }],
    ["confirmTechnicianHvLevel", { path: { dealershipId, technicianId }, headers: { "If-Match": '"722"' } }],
    ["listAdminTechnicians", { path: { dealershipId } }],
    ["getAdminHistory", { path: { dealershipId }, query: { resourceKind: "policy", offset: 25, limit: 25 } }],
    ["editRequirementPolicy", { path: { dealershipId }, body: { rules: [], dryRun: true, previewDate: "2026-10-13" }, headers: { "If-Match": '"policy-2"' } }],
  ] as const)("send %s as the generated SDK does", async (name, options) => {
    const generated = await sent(() => (sdk[name] as (options: object) => Promise<unknown>)({ ...options, throwOnError: true }))
    const ours = await sent(() => (admin[name] as (options: object) => Promise<unknown>)({ ...options, throwOnError: true }))

    expect({ ...ours, requestId: undefined }).toEqual({ ...generated, requestId: undefined })
    // Through the app's client, with its request id.
    expect(ours.requestId).toMatch(/^[0-9a-f-]{36}$/)
  })
})
