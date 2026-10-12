import {
  confirmTechnicianHvLevel,
  createBay,
  createTechnician,
  editBay,
  editRequirementPolicy,
  editTechnician,
} from "@/api/sdk.gen"
import type {
  AdminBayResponse,
  AdminPolicyResponse,
  AdminTechnicianResponse,
  BayWriteRequest,
  PolicyEditResponse,
  PolicyWriteRequest,
  TechnicianWriteRequest,
} from "@/api/types.gen"
import { parseProblem, problemSlug } from "@/lib/problem-details"

/**
 * The Admin API's writes (Task 30a), as the Resources area sends them. Every one is an Admin's edit bound to the Admin who
 * made it: it is given the bound write's `fetch` (`useWriteMutation` with `writes: "admin"`), which checks the account
 * immediately before the request leaves. An edit of a record carries the version it was based on as `If-Match`: a
 * technician's or bay's `version` (PostgreSQL `xmin`) quoted, `"712"`, and the policy's `"policy-2"`. The API answers a
 * missing one with `428 precondition-required` and a stale one with `412 precondition-failed`, carrying the current
 * representation and its tag (`conflictOf`). A create has no record to match yet.
 */

/** A technician's or bay's strong ETag from its `version`: `"712"`. */
export const resourceTag = (version: number) => `"${version}"`

/** The policy's ETag from its logical version: `"policy-2"`. */
export const policyTag = (version: number) => `"policy-${version}"`

/** The fetch an Admin's write is sent with: the bound write's, checked as the request leaves. */
export interface BoundFetch {
  fetch: typeof fetch
}

export interface TechnicianSave extends BoundFetch {
  dealershipId: string
  /** The technician to edit; absent to add one. */
  id?: string
  body: TechnicianWriteRequest
  /** The ETag of the representation the edit was made from (an edit only). */
  ifMatch?: string
}

/** Adds a technician (`POST`, `201`) or replaces one's whole state (`PUT` with `If-Match`). Throws the API's problem. */
export async function saveTechnician({ dealershipId, id, body, ifMatch, fetch }: TechnicianSave): Promise<AdminTechnicianResponse> {
  if (id) {
    const headers = ifMatch ? { "If-Match": ifMatch } : undefined
    return (await editTechnician({ path: { dealershipId, technicianId: id }, body, headers, fetch, throwOnError: true })).data
  }
  return (await createTechnician({ path: { dealershipId }, body, fetch, throwOnError: true })).data
}

/** Confirms a technician's HV level as recorded (a bodyless `POST` with `If-Match`): level, expiry and the rest stay. */
export async function confirmHvLevel({
  dealershipId,
  id,
  ifMatch,
  fetch,
}: BoundFetch & { dealershipId: string; id: string; ifMatch: string }): Promise<AdminTechnicianResponse> {
  return (await confirmTechnicianHvLevel({ path: { dealershipId, technicianId: id }, headers: { "If-Match": ifMatch }, fetch, throwOnError: true }))
    .data
}

export interface BaySave extends BoundFetch {
  dealershipId: string
  id?: string
  body: BayWriteRequest
  ifMatch?: string
}

/** Adds a bay or replaces one's whole state, as `saveTechnician`. */
export async function saveBay({ dealershipId, id, body, ifMatch, fetch }: BaySave): Promise<AdminBayResponse> {
  if (id) {
    const headers = ifMatch ? { "If-Match": ifMatch } : undefined
    return (await editBay({ path: { dealershipId, bayId: id }, body, headers, fetch, throwOnError: true })).data
  }
  return (await createBay({ path: { dealershipId }, body, fetch, throwOnError: true })).data
}

/**
 * Sends a whole policy (`PUT /requirement-policy`): with `dryRun` the API answers what would change and writes nothing;
 * without, it publishes version n+1 if `If-Match` is still the current version.
 */
export async function writePolicy({
  dealershipId,
  body,
  ifMatch,
  fetch,
}: BoundFetch & { dealershipId: string; body: PolicyWriteRequest; ifMatch: string }): Promise<PolicyEditResponse> {
  return (await editRequirementPolicy({ path: { dealershipId }, body, headers: { "If-Match": ifMatch }, fetch, throwOnError: true })).data
}

/** A `412 precondition-failed`: the record as it is now and its tag, to show what changed and to reapply against. */
export interface Conflict<T> {
  current: T
  currentETag: string
}

/** The 412 in a failure, if it is one with the current representation; `null` otherwise. */
export function conflictOf<T extends AdminTechnicianResponse | AdminBayResponse | AdminPolicyResponse>(error: unknown): Conflict<T> | null {
  const problem = parseProblem(error)
  if (!problem || problemSlug(problem) !== "precondition-failed") return null
  const { current, currentETag } = problem
  if (typeof currentETag !== "string" || typeof current !== "object" || current === null) return null
  return { current: current as T, currentETag }
}

/** A `428 precondition-required`: the edit left without the version it was based on (a fault of the app, never the user's). */
export function preconditionMissing(error: unknown): boolean {
  const problem = parseProblem(error)
  return problem !== null && problemSlug(problem) === "precondition-required"
}
