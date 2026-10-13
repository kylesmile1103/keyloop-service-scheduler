import type {
  AdminBayResponse,
  AdminHistoryItem,
  AdminPolicyResponse,
  AdminTechnicianResponse,
  BayWriteRequest,
  CurrentUserResponse,
  PolicyBookabilityChange,
  PolicyWriteRequest,
  RequirementRuleInput,
  TechnicianWriteRequest,
} from "@/api/types.gen"
import { reading } from "@/test/dealerships"
import { admin } from "@/test/identities"
import { jsonResponse, problemResponse } from "@/test/mock-api"
import { readingTuesday } from "@/test/schedules"
import { readingTuesdayWithCompetence } from "@/test/vehicle"

/**
 * The Admin API of Task 30a as a small in-memory server, for the Resources area's editing tests: the technicians, bays and
 * requirement policy of Reading, each with its version (the API's `xmin`, sent as a strong ETag `"712"`; a policy's is
 * `"policy-2"`), the 428 and 412 refusals with the current representation, the dry-run preview, and the audit history. Every
 * route answers 403 for a caller who is not an Admin, as the API does. Tests can change a record as another Admin would,
 * between the reads and a write (`editedElsewhere`).
 */

const problems = "https://api.keyloop.example/problems/"
export const ADMIN_TRACE_ID = "00-5c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f-6a7b8c9d0e1f2a3b-01"

/** The versions the fixtures start at: a technician's, a bay's and the policy's. */
export const TECHNICIAN_VERSION = 712
export const BAY_VERSION = 530
export const POLICY_VERSION = 2

const hv: RequirementRuleInput["powertrains"] = ["MildHybrid", "FullHybrid", "PluginHybrid", "BatteryElectric", "FuelCell", "Unknown"]
const serviceRule = (code: string, order: number, minimumHvLevel: number, serviceCodes: string[]): RequirementRuleInput => ({
  code,
  order,
  condition: "ServicePowertrain",
  powertrains: hv,
  serviceCodes,
  vehicleClass: null,
  minimumHvLevel,
  bayCapabilities: [],
  certifications: [],
})

/** The default policy, version 2 (`RequirementRule.DefaultPolicy`), as `GET /requirement-policy` answers it. */
export const defaultRules: RequirementRuleInput[] = [
  serviceRule("hv-awareness", 10, 1, ["WHEEL-ALIGNMENT", "MOT-TEST"]),
  serviceRule("hv-routine", 20, 2, ["INTERIM-SERVICE", "FULL-SERVICE", "BRAKES-PADS-DISCS", "DIAG-FAULT-FINDING", "HEAVY-VAN-SERVICE"]),
  serviceRule("hv-aircon", 30, 3, ["AIRCON-REGAS"]),
  { ...serviceRule("hv-components", 40, 3, ["EV-BATTERY-CHECK", "EV-CHARGING-FAULT"]), bayCapabilities: ["EvHighVoltage"] },
  serviceRule("hv-post-collision", 45, 3, ["ACCIDENT-DAMAGE-ASSESSMENT"]),
  {
    code: "heavy-vehicle",
    order: 50,
    condition: "VehicleClass",
    powertrains: [],
    serviceCodes: [],
    vehicleClass: "Heavy",
    minimumHvLevel: 0,
    bayCapabilities: ["HeavyDutyLift"],
    certifications: ["HeavyVehicle"],
  },
  {
    code: "hv-live-diagnosis",
    order: 60,
    condition: "LiveDiagnosis",
    powertrains: [],
    serviceCodes: [],
    vehicleClass: null,
    minimumHvLevel: 4,
    bayCapabilities: ["EvHighVoltage"],
    certifications: [],
  },
]

/** Reading's roster as the Admin reads it: the seeded, confirmed levels, each technician at its own version. */
export function adminTechnicians(): AdminTechnicianResponse[] {
  return readingTuesdayWithCompetence.technicians.map((technician, index) => ({
    id: technician.id,
    dealershipId: reading.id,
    name: technician.name,
    employeeNumber: technician.employeeNumber,
    certifications: technician.certifications,
    isActive: technician.isActive,
    hvLevel: technician.hvLevel ?? 0,
    hvLevelValidUntil: technician.hvLevelValidUntil ?? null,
    hvLevelConfirmed: technician.hvLevelConfirmed ?? true,
    brandSpecialisms: technician.brandSpecialisms ?? [],
    version: TECHNICIAN_VERSION + index * 10,
  }))
}

/** Reading's bays as the Admin reads them. */
export function adminBays(): AdminBayResponse[] {
  return readingTuesday.bays.map((bay, index) => ({
    id: bay.id,
    dealershipId: reading.id,
    name: bay.name,
    capabilities: bay.capabilities,
    isActive: bay.isActive,
    version: BAY_VERSION + index * 10,
  }))
}

export const etagOf = (version: number) => `"${version}"`
export const policyETagOf = (version: number) => `"policy-${version}"`

const technicianWrite = (record: AdminTechnicianResponse): TechnicianWriteRequest => ({
  name: record.name,
  employeeNumber: record.employeeNumber,
  certifications: record.certifications,
  isActive: record.isActive,
  hvLevel: record.hvLevel,
  hvLevelValidUntil: record.hvLevelValidUntil,
  hvLevelConfirmed: record.hvLevelConfirmed,
  brandSpecialisms: record.brandSpecialisms,
})

const bayWrite = (record: AdminBayResponse): BayWriteRequest => ({ name: record.name, capabilities: record.capabilities, isActive: record.isActive })

export interface AdminServerOptions {
  /** Who is asking (the board API's `me`): every route answers 403 unless it is an Admin. By default: an Admin. */
  me?: () => CurrentUserResponse
  technicians?: (records: AdminTechnicianResponse[]) => AdminTechnicianResponse[]
  bays?: (records: AdminBayResponse[]) => AdminBayResponse[]
  /** The bookability changes a preview or a publication reports for the rules sent. By default: none. */
  changes?: (rules: readonly RequirementRuleInput[]) => PolicyBookabilityChange[]
  history?: AdminHistoryItem[]
  /** Answers a write in its place (a 400 with field errors, a 503), after the precondition checks. */
  refuse?: (request: Request) => Response | undefined
  /** Answers an Admin read in its place (a 503 for a read again after a 428). */
  refuseRead?: (request: Request) => Response | undefined
}

/** A stand-in for the API's preview token: deterministic over the same inputs, different when any of them changes. */
function tokenOf(version: number, rules: readonly RequirementRuleInput[], previewDate: string, changes: readonly unknown[], roster: number) {
  const text = JSON.stringify([version, rules, previewDate, changes, roster])
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0
  return `preview-${hash.toString(36)}`
}

/** A request's JSON body, read from a copy so the recorded request stays readable for assertions. */
const bodyOf = async <T>(request: Request) => (await request.clone().json()) as T

export function adminServer(options: AdminServerOptions = {}) {
  const me = options.me ?? (() => admin)
  const actor = () => `user:${me().email ?? "unknown"}`
  const state = {
    technicians: (options.technicians ?? ((records) => records))(adminTechnicians()),
    bays: (options.bays ?? ((records) => records))(adminBays()),
    policy: { dealershipId: reading.id, version: POLICY_VERSION, rules: defaultRules } as AdminPolicyResponse,
    history: [...(options.history ?? [])],
    /** Advanced by `editedElsewhere.rosterConsequences`: a roster edit that changes what a policy would make bookable. */
    rosterRevision: 0,
  }
  let nextVersion = 900
  let nextId = 1
  let clock = Date.parse("2026-10-13T08:30:00Z")
  const bump = () => (nextVersion += 7)
  const newId = (prefix: string) => `${prefix}-0000-4000-8000-${String(nextId++).padStart(12, "0")}`

  function record(item: Omit<AdminHistoryItem, "id" | "atUtc" | "actor">, by = actor()) {
    clock += 60_000
    state.history.unshift({ id: newId("a0000000"), atUtc: new Date(clock).toISOString().replace(".000Z", "Z"), actor: by, ...item })
  }

  const forbidden = () =>
    problemResponse(403, { type: `${problems}forbidden`, title: "Forbidden", status: 403, detail: "This action needs the Admin role.", traceId: ADMIN_TRACE_ID })
  const notFound = () => problemResponse(404, { type: `${problems}not-found`, title: "Resource not found", status: 404, traceId: ADMIN_TRACE_ID })
  const required = () =>
    problemResponse(428, {
      type: `${problems}precondition-required`,
      title: "Precondition required",
      status: 428,
      detail: "Send the ETag from the resource read in If-Match.",
      traceId: ADMIN_TRACE_ID,
    })
  const failed = (current: object, currentETag: string) =>
    new Response(
      JSON.stringify({
        type: `${problems}precondition-failed`,
        title: "Precondition failed",
        status: 412,
        detail: "The resource changed. Reload it before reapplying the edit.",
        traceId: ADMIN_TRACE_ID,
        currentETag,
        current,
      }),
      { status: 412, headers: { "Content-Type": "application/problem+json", ETag: currentETag } }
    )
  /** `null` when the request's If-Match is the current tag; the refusal otherwise. */
  const precondition = (request: Request, currentTag: string, current: object) => {
    const ifMatch = request.headers.get("If-Match")
    if (!ifMatch) return required()
    return ifMatch.trim() === currentTag ? null : failed(current, currentTag)
  }
  const withTag = (body: object, tag: string, status = 200, location?: string) =>
    jsonResponse(body, { status, headers: { ETag: tag, ...(location ? { Location: location } : {}) } })
  const activity = (before: { isActive: boolean }, after: { isActive: boolean }) =>
    before.isActive === after.isActive ? "edit" : after.isActive ? "reactivate" : "deactivate"

  async function handle(request: Request, url: URL): Promise<Response | null> {
    const match = /^\/api\/v1\/dealerships\/([^/]+)\/(technicians|bays|requirement-policy|admin-history)(?:\/([^/]+))?(?:\/(confirm-hv-level))?$/.exec(url.pathname)
    if (!match) return null
    if (!me().roles.includes("Admin")) return forbidden()
    const [, , kind, id, confirm] = match
    const method = request.method
    const readRefused = method === "GET" ? options.refuseRead?.(request) : undefined
    if (readRefused) return readRefused

    if (kind === "admin-history") {
      const resourceKind = url.searchParams.get("resourceKind")
      const resourceId = url.searchParams.get("resourceId")
      const offset = Number(url.searchParams.get("offset") ?? 0)
      const limit = Number(url.searchParams.get("limit") ?? 50)
      const items = state.history.filter(
        (item) => (!resourceKind || item.resourceKind === resourceKind) && (!resourceId || item.resourceId === resourceId)
      )
      const page = items.slice(offset, offset + limit)
      return jsonResponse({ items: page, nextOffset: offset + limit < items.length ? offset + limit : null })
    }

    if (kind === "requirement-policy") {
      const tag = policyETagOf(state.policy.version)
      if (method === "GET") return withTag(state.policy, tag)
      const refusal = precondition(request, tag, state.policy)
      if (refusal) return refusal
      const body = await bodyOf<PolicyWriteRequest>(request)
      const refused = options.refuse?.(request)
      if (refused) return refused
      const rules = [...body.rules].sort((a, b) => a.order - b.order || a.code.localeCompare(b.code))
      const proposed: AdminPolicyResponse = { dealershipId: state.policy.dealershipId, version: state.policy.version + 1, rules }
      const changes = options.changes?.(rules) ?? []
      // The API's previewToken (Task 30c): a fingerprint of the version, rules, date and consequences (here with the roster's
      // revision standing in for consequences that changed), required to publish and compared then.
      const previewToken = tokenOf(state.policy.version, rules, body.previewDate, changes, state.rosterRevision)
      if (body.dryRun) return withTag({ saved: false, policy: proposed, previewDate: body.previewDate, changes, previewToken }, tag)
      if (!body.previewToken) {
        return problemResponse(400, {
          type: `${problems}validation-error`,
          title: "One or more validation errors occurred",
          status: 400,
          traceId: ADMIN_TRACE_ID,
          errors: { previewToken: ["Publish needs the previewToken of the preview you confirmed."] },
        })
      }
      if (body.previewToken !== previewToken) {
        return problemResponse(409, {
          type: `${problems}policy-preview-outdated`,
          title: "The preview is out of date",
          status: 409,
          detail: "The roster or date consequences changed since the preview. Run the preview again before publishing.",
          traceId: ADMIN_TRACE_ID,
        })
      }
      record({ resourceKind: "policy", resourceId: state.policy.dealershipId, action: "publish", before: state.policy, after: proposed })
      state.policy = proposed
      return withTag({ saved: true, policy: proposed, previewDate: body.previewDate, changes, previewToken }, policyETagOf(proposed.version))
    }

    if (kind === "technicians") {
      const list = state.technicians
      if (!id) {
        if (method === "GET") return jsonResponse([...list].sort((a, b) => a.name.localeCompare(b.name)))
        const body = await bodyOf<TechnicianWriteRequest>(request)
        const refused = options.refuse?.(request)
        if (refused) return refused
        const created: AdminTechnicianResponse = { id: newId("c0000000"), dealershipId: reading.id, ...body, version: bump() }
        list.push(created)
        record({ resourceKind: "technician", resourceId: created.id, action: "create", before: null, after: technicianWrite(created) })
        return withTag(created, etagOf(created.version), 201, `/api/v1/dealerships/${reading.id}/technicians/${created.id}`)
      }
      const index = list.findIndex((candidate) => candidate.id === id)
      if (index === -1) return notFound()
      const current = list[index]
      if (method === "GET" && !confirm) return withTag(current, etagOf(current.version))
      const refusal = precondition(request, etagOf(current.version), current)
      if (refusal) return refusal
      const refused = options.refuse?.(request)
      if (refused) return refused
      if (confirm) {
        const confirmed = { ...current, hvLevelConfirmed: true, version: bump() }
        list[index] = confirmed
        record({ resourceKind: "technician", resourceId: id, action: "confirm-hv", before: technicianWrite(current), after: technicianWrite(confirmed) })
        return withTag(confirmed, etagOf(confirmed.version))
      }
      const body = await bodyOf<TechnicianWriteRequest>(request)
      const edited = { ...current, ...body, version: bump() }
      list[index] = edited
      record({ resourceKind: "technician", resourceId: id, action: activity(current, edited), before: technicianWrite(current), after: technicianWrite(edited) })
      return withTag(edited, etagOf(edited.version))
    }

    const list = state.bays
    if (!id) {
      if (method === "GET") return jsonResponse([...list].sort((a, b) => a.name.localeCompare(b.name)))
      const body = await bodyOf<BayWriteRequest>(request)
      const refused = options.refuse?.(request)
      if (refused) return refused
      const created: AdminBayResponse = { id: newId("b0000000"), dealershipId: reading.id, ...body, version: bump() }
      list.push(created)
      record({ resourceKind: "bay", resourceId: created.id, action: "create", before: null, after: bayWrite(created) })
      return withTag(created, etagOf(created.version), 201, `/api/v1/dealerships/${reading.id}/bays/${created.id}`)
    }
    const index = list.findIndex((candidate) => candidate.id === id)
    if (index === -1) return notFound()
    const current = list[index]
    if (method === "GET") return withTag(current, etagOf(current.version))
    const refusal = precondition(request, etagOf(current.version), current)
    if (refusal) return refusal
    const refused = options.refuse?.(request)
    if (refused) return refused
    const body = await bodyOf<BayWriteRequest>(request)
    const edited = { ...current, ...body, version: bump() }
    list[index] = edited
    record({ resourceKind: "bay", resourceId: id, action: activity(current, edited), before: bayWrite(current), after: bayWrite(edited) })
    return withTag(edited, etagOf(edited.version))
  }

  /** Another Admin's save, between this page's read and its write: the record changes and gets a new version. */
  const editedElsewhere = {
    technician(id: string, changes: Partial<TechnicianWriteRequest>) {
      const index = state.technicians.findIndex((candidate) => candidate.id === id)
      const before = state.technicians[index]
      const after = { ...before, ...changes, version: bump() }
      state.technicians[index] = after
      record({ resourceKind: "technician", resourceId: id, action: activity(before, after), before: technicianWrite(before), after: technicianWrite(after) }, "user:another.admin@keyloop.test")
      return after
    },
    bay(id: string, changes: Partial<BayWriteRequest>) {
      const index = state.bays.findIndex((candidate) => candidate.id === id)
      const before = state.bays[index]
      const after = { ...before, ...changes, version: bump() }
      state.bays[index] = after
      record({ resourceKind: "bay", resourceId: id, action: activity(before, after), before: bayWrite(before), after: bayWrite(after) }, "user:another.admin@keyloop.test")
      return after
    },
    /** A roster edit elsewhere that changes what the draft policy would make bookable: an earlier preview is out of date. */
    rosterConsequences() {
      state.rosterRevision += 1
    },
    policy(rules: RequirementRuleInput[]) {
      const before = state.policy
      const after = { ...before, version: before.version + 1, rules }
      state.policy = after
      record({ resourceKind: "policy", resourceId: before.dealershipId, action: "publish", before, after }, "user:another.admin@keyloop.test")
      return after
    },
  }

  return { state, handle, editedElsewhere }
}

export type AdminServer = ReturnType<typeof adminServer>
