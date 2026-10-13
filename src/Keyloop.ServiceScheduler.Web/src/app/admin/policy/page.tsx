import { useQuery, useQueryClient } from "@tanstack/react-query"
import { LoaderCircle, Pencil, Plus, Scale, Trash2, Undo2 } from "lucide-react"
import { useId, useRef, useState } from "react"
import { flushSync } from "react-dom"

import { getServiceTypesOptions } from "@/api/@tanstack/react-query.gen"
import type { AdminPolicyResponse, PolicyEditResponse, RequirementRuleInput, ServiceTypeResponse } from "@/api/types.gen"
import { CapabilityBadges } from "@/components/capability-badges"
import { HvLevelBadge } from "@/components/hv-level"
import { ProblemAlert } from "@/components/problem-alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import { useCurrentUser } from "@/hooks/use-current-user"
import { useQueryFailure } from "@/hooks/use-query-failure"
import { useWriteMutation } from "@/hooks/use-write-mutation"
import { authRefusalTitle, failureStatus, parseProblem, problemSlug } from "@/lib/problem-details"
import { cachedCapabilities } from "@/lib/session"
import { cn } from "@/lib/utils"
import { hvLevelOf } from "@/lib/vehicle-aware"

import { ReadOnlyNote } from "../components/admin-access"
import { ConflictPanel } from "../components/conflict-panel"
import { DiscardedNote } from "../components/discarded-note"
import { ResourcePage, type ResourceScope } from "../components/resource-page"
import { conflictOf, policyTag, writePolicy } from "../lib/admin-api"
import { requirementPolicyQuery } from "../lib/admin-reads"
import type { ConflictRow } from "../lib/changes"
import { useRefreshAfterEdit } from "../lib/refresh"
import { useAdminAccess } from "../lib/use-admin-access"
import { PolicyPreview } from "./preview"
import { RuleDialog } from "./rule-dialog"
import { blankRule, carriedOnto, inOrder, type RuleChange, ruleChanges, ruleSummary, whenWords } from "./rule-words"
import { PolicyVersions } from "./versions"

/**
 * The Requirement policy page (`/resources/policy`, Task 30b): one dealership's typed rules (ADR-029), what each job needs
 * from the technician and the bay. An Admin edits a draft, previews what it would change with today's roster (the API's
 * dry-run), and publishes it as the next version; every version stays, and appointments keep the one they were booked
 * under. A Service advisor or a Viewer is told the policy is the Admin's (the API answers only an Admin).
 */
export default function PolicyPage() {
  return (
    <ResourcePage title="Requirement policy" description="What each job needs from the technician and the bay, by service, powertrain, vehicle class and live HV work.">
      {(scope) => <PolicyView {...scope} />}
    </ResourcePage>
  )
}

function PolicyView(scope: ResourceScope) {
  const access = useAdminAccess("the requirement policy")
  const reasonId = useId()
  if (!access.admin) {
    return (
      <Card className="gap-3 px-4 py-4 sm:px-6">
        <h2 className="flex items-center gap-2 font-heading text-lg font-semibold">
          <Scale aria-hidden="true" className="size-5 text-muted-foreground" />
          Kept by an Admin
        </h2>
        <ReadOnlyNote
          id={reasonId}
          reason="The requirement policy is kept by a workshop Admin: it decides the HV level, equipment and certifications each job needs. Your role can see what a booking needed in its details sheet."
        />
      </Card>
    )
  }
  return <PolicyEditor {...scope} />
}

/** The draft: the version it was made from, its rules, and the Admin who made it. */
interface Draft {
  identity: string
  base: AdminPolicyResponse
  rules: RequirementRuleInput[]
}

type WriteVariables = {
  identity: string
  rules: RequirementRuleInput[]
  dryRun: boolean
  ifMatch: string
  previewDate: string
  /** Publishing only: the token of the preview the Admin confirmed (Task 30c); the API refuses a publication that no longer matches it. */
  previewToken?: string
  key: string
}

const changeLabel: Record<RuleChange, string> = { added: "New", changed: "Changed", removed: "Removed" }

function PolicyEditor({ dealership, today, phone }: ResourceScope) {
  const queryClient = useQueryClient()
  // The draft is the Admin's who made it (`adminWriter`), as a booking being entered is its writer's.
  const { adminWriter } = useCurrentUser()
  const identity = adminWriter ?? ""
  const refresh = useRefreshAfterEdit()
  const pendingReasonId = useId()
  const conflictRef = useRef<HTMLElement>(null)
  const policyOptions = requirementPolicyQuery(dealership.id)
  const policy = useQuery({ ...policyOptions, enabled: () => cachedCapabilities(queryClient).isAdmin })
  const policyFailure = useQueryFailure(policy, policyOptions.queryKey)
  const catalogue = useQuery(getServiceTypesOptions({ path: { dealershipId: dealership.id } }))
  const services = catalogue.data

  const [draft, setDraft] = useState<Draft | null>(null)
  const [discarded, setDiscarded] = useState(false)
  const [preview, setPreview] = useState<{ key: string; result: PolicyEditResponse } | null>(null)
  const [conflict, setConflict] = useState<{ opened: AdminPolicyResponse; current: AdminPolicyResponse; mine: RequirementRuleInput[] } | null>(null)
  const [editing, setEditing] = useState<{ rule: RequirementRuleInput; isNew: boolean } | null>(null)
  // The draft whose publication the API refused as out of date (409 policy-preview-outdated): its preview is gone, and the
  // bar asks for a new one, for that draft only.
  const [outdated, setOutdated] = useState<string | null>(null)
  const previewAgainRef = useRef<HTMLButtonElement>(null)
  const publishRef = useRef<HTMLButtonElement>(null)
  const previewButtonRef = useRef<HTMLButtonElement>(null)
  const addRuleRef = useRef<HTMLButtonElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  // A control that takes itself away (Remove, Put back, Discard, Keep, Publish) hands focus on before it goes, so focus is
  // never lost to the page: first to Add rule, which is always there, then (once the change is drawn) to what comes next.
  const handOff = (change: () => void, next?: () => HTMLElement | null | undefined) => {
    addRuleRef.current?.focus()
    flushSync(change)
    next?.()?.focus()
  }
  const inCard = (label: string) => cardRef.current?.querySelector<HTMLElement>(`[aria-label="${label}"]`)
  // Everything the editor holds is the Admin's it was made for: the draft, an open rule, a preview and a 412's comparison
  // (whose "Keep my changes" would carry the rules into a new draft). Another Admin, or a role that cannot edit, drops all
  // of it in the render the change arrives in (React's pattern for state that follows a prop), never painting for the next
  // caller; the last write's failure and progress show only for the Admin it was sent for (below).
  const [shownFor, setShownFor] = useState(identity)
  if (shownFor !== identity) {
    setShownFor(identity)
    if (draft || conflict || editing) setDiscarded(true)
    setDraft(null)
    setPreview(null)
    setConflict(null)
    setEditing(null)
    setOutdated(null)
  }

  const base = draft?.base ?? policy.data
  const rules = inOrder(draft?.rules ?? base?.rules ?? [])
  const changes = base ? ruleChanges(base.rules, rules) : new Map<string, RuleChange>()
  const removed = base ? inOrder(base.rules.filter((rule) => changes.get(rule.code) === "removed")) : []
  // A preview counts only for the Admin, version and rules it was made for.
  const draftKey = base ? `${identity}|${base.version}|${JSON.stringify(rules)}` : ""
  const previewed = preview?.key === draftKey ? preview.result : null

  const write = useWriteMutation<PolicyEditResponse, unknown, WriteVariables>({
    writes: "admin",
    mutationFn: ({ rules: sent, dryRun, ifMatch, previewDate, previewToken }, bound) =>
      writePolicy({ dealershipId: dealership.id, body: { rules: sent, dryRun, previewDate, previewToken }, ifMatch, fetch: bound.fetch() }),
    onSuccess: (result, variables) => {
      if (variables.dryRun) {
        // Preview again goes with its alert: focus moves first to what comes next, Publish, so it is not lost to the page.
        if (previewAgainRef.current !== null && previewAgainRef.current === document.activeElement) publishRef.current?.focus()
        setPreview({ key: variables.key, result })
        setOutdated(null)
        return
      }
      handOff(() => {
        setDraft(null)
        setPreview(null)
        queryClient.setQueryData(policyOptions.queryKey, result.policy)
      })
      void refresh(dealership.id)
      toast.add({
        type: "success",
        title: `Policy version ${result.policy.version} published`,
        description: "New bookings use it from now on. Appointments keep the version they were booked under.",
      })
    },
    onError: (error, variables) => {
      // The roster (or what the date makes valid) changed after the preview: nothing was published, and the preview the
      // Admin confirmed no longer says what publishing would do. It goes, so Publish waits for a new one.
      const problem = parseProblem(error)
      if (!variables.dryRun && problem !== null && problemSlug(problem) === "policy-preview-outdated") {
        flushSync(() => {
          setPreview(null)
          setOutdated(variables.key)
        })
        previewAgainRef.current?.focus()
        return
      }
      const stale = conflictOf<AdminPolicyResponse>(error)
      if (stale && base) {
        flushSync(() => setConflict({ opened: base, current: stale.current, mine: variables.rules }))
        conflictRef.current?.focus()
      }
    },
  })

  const edit = (next: RequirementRuleInput[]) => {
    if (!base) return
    setDiscarded(false)
    setConflict(null)
    write.reset()
    setDraft({ identity, base, rules: next })
  }
  const send = (dryRun: boolean) => {
    if (!base) return
    // Publishing sends exactly the draft previewed, with the preview's date and token.
    if (!dryRun && !previewed) return
    const sendWrite = write.begin()
    if (!sendWrite) return
    setConflict(null)
    sendWrite({
      identity,
      rules,
      dryRun,
      ifMatch: policyTag(base.version),
      previewDate: dryRun ? today : (previewed?.previewDate ?? today),
      previewToken: dryRun ? undefined : previewed?.previewToken,
      key: draftKey,
    })
  }
  const keepMine = () => {
    if (!conflict) return
    // Next: a new preview of the carried draft.
    handOff(() => {
      queryClient.setQueryData(policyOptions.queryKey, conflict.current)
      setDraft({ identity, base: conflict.current, rules: carriedOnto(conflict.opened.rules, conflict.current.rules, conflict.mine) })
      setConflict(null)
      write.reset()
    }, () => previewButtonRef.current)
  }
  const dropMine = () => {
    if (!conflict) return
    handOff(() => {
      queryClient.setQueryData(policyOptions.queryKey, conflict.current)
      setDraft(null)
      setConflict(null)
      write.reset()
    })
  }
  const remove = (rule: RequirementRuleInput) =>
    handOff(() => edit(rules.filter((other) => other.code !== rule.code)), () => inCard(`Put ${rule.code} back`))
  const putBack = (rule: RequirementRuleInput) => handOff(() => edit(inOrder([...rules, rule])), () => inCard(`Edit ${rule.code}`))

  if (!base) {
    if (policyFailure !== null) {
      return (
        <Card className="py-0">
          <ProblemAlert title="Couldn’t load the requirement policy" error={policyFailure} onRetry={() => void policy.refetch()} retrying={policy.isFetching} className="m-4" />
        </Card>
      )
    }
    return (
      <Card aria-busy="true" className="gap-3 px-4 py-4">
        <p role="status" className="sr-only">
          Loading the requirement policy…
        </p>
        <Skeleton className="h-6 w-40" />
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </Card>
    )
  }

  // The last write's outcome is its Admin's: a failure (or a send under way) from before a change of caller is not shown.
  const ownWrite = write.variables?.identity === identity
  const pending = write.isPending && ownWrite
  const isOutdated = outdated !== null && outdated === draftKey
  const failure = write.error && !conflict && !isOutdated && ownWrite ? write.error : null
  const failureTitle = (() => {
    const status = failureStatus(failure)
    if (status === 401 || status === 403) return authRefusalTitle(status, "change the policy")
    return previewed ? "Couldn’t publish the policy" : "Couldn’t preview the changes"
  })()
  const nextVersion = base.version + 1
  const count = changes.size

  return (
    <>
      {discarded && <DiscardedNote>Your unpublished changes were discarded: who is signed in changed.</DiscardedNote>}
      <Card ref={cardRef} className="gap-0 py-0">
        <div className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b px-4 py-3")}>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-lg font-semibold tabular-nums">{`Version ${base.version}`}</h2>
              <Badge variant="secondary" className="font-normal">
                In use at {dealership.name}
              </Badge>
            </div>
            <p className="max-w-prose text-sm text-pretty text-muted-foreground">
              New bookings use the latest version; appointments keep the version they were booked under. A rule only adds needs.
            </p>
          </div>
          <Button ref={addRuleRef} type="button" onClick={() => setEditing({ rule: blankRule(rules), isNew: true })} className={cn("cursor-pointer", phone && "w-full")}>
            <Plus aria-hidden="true" />
            Add rule
          </Button>
        </div>

        {phone ? (
          <RuleCards rules={rules} changes={changes} services={services} onEdit={(rule) => setEditing({ rule, isNew: false })} onRemove={remove} />
        ) : (
          <RuleTable rules={rules} changes={changes} services={services} onEdit={(rule) => setEditing({ rule, isNew: false })} onRemove={remove} />
        )}

        {removed.length > 0 && (
          <div className="flex flex-col gap-2 border-t px-4 py-3">
            <p className="text-sm font-medium">Removed in this draft</p>
            <ul aria-label="Removed rules" className="flex flex-wrap gap-2">
              {removed.map((rule) => (
                <li key={rule.code} className="flex items-center gap-1 rounded-full border border-dashed border-input py-0.5 pr-0.5 pl-3 text-sm">
                  <code className="font-mono text-xs tracking-wide line-through decoration-muted-foreground">{rule.code}</code>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={`Put ${rule.code} back`} className="rounded-full" onClick={() => putBack(rule)}>
                    <Undo2 aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {count > 0 && (
          <div className="flex flex-col gap-3 border-t bg-muted/30 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-pretty">
              <span className="font-semibold tabular-nums">{`${count === 1 ? "1 change" : `${count} changes`} to version ${base.version}`}</span>
              <span id={pendingReasonId} className="ml-2 text-muted-foreground">
                {previewed ? "Previewed: ready to publish." : isOutdated ? "The preview is out of date: preview again." : "Preview the changes before publishing them."}
              </span>
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  handOff(() => {
                    setDraft(null)
                    write.reset()
                  })
                }
                className="cursor-pointer max-sm:h-11"
                disabled={pending}
              >
                Discard changes
              </Button>
              <Button
                ref={previewButtonRef}
                type="button"
                variant={previewed ? "outline" : "default"}
                onClick={() => send(true)}
                disabled={pending}
                focusableWhenDisabled
                className="cursor-pointer max-sm:h-11"
              >
                {pending && write.variables?.dryRun && <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
                Preview changes
              </Button>
              <Button
                ref={publishRef}
                type="button"
                variant={previewed ? "default" : "outline"}
                onClick={() => send(false)}
                disabled={!previewed || pending}
                focusableWhenDisabled
                aria-describedby={previewed ? undefined : pendingReasonId}
                className="cursor-pointer max-sm:h-11"
              >
                {pending && write.variables?.dryRun === false && <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
                {`Publish version ${nextVersion}`}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {conflict && (
        <ConflictPanel
          ref={conflictRef}
          title={`Version ${conflict.current.version} was published while you were editing`}
          rows={policyConflictRows(conflict.opened, conflict.current, conflict.mine, services)}
          columns={{ field: "Rule", opened: `Version ${conflict.opened.version}`, now: `Version ${conflict.current.version} (now)` }}
          actions={
            <>
              <Button type="button" onClick={keepMine} className="cursor-pointer">
                {`Keep my changes on version ${conflict.current.version}`}
              </Button>
              <Button type="button" variant="outline" onClick={dropMine} className="cursor-pointer">
                Discard my changes
              </Button>
            </>
          }
        >
          <p>Another Admin published a version after you started, so nothing of yours was published.</p>
          <p className="text-muted-foreground">Keeping your changes puts them on top of the new version; preview again before publishing.</p>
        </ConflictPanel>
      )}
      {isOutdated && (
        <ProblemAlert
          title="The preview is out of date"
          error={write.error}
          tone="warning"
          actions={
            <Button ref={previewAgainRef} type="button" variant="outline" size="sm" onClick={() => send(true)} disabled={pending} focusableWhenDisabled className="cursor-pointer text-foreground">
              {pending && <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
              Preview again
            </Button>
          }
        >
          <p>{`Nothing was published: the roster changed after your preview, so it no longer says what version ${nextVersion} would change. Preview again, check it, then publish.`}</p>
        </ProblemAlert>
      )}
      {failure !== null && (
        <ProblemAlert title={failureTitle} error={failure} tone={(failureStatus(failure) ?? 500) < 500 ? "warning" : "error"}>
          <RuleErrors failure={failure} sent={write.variables?.rules ?? rules} />
        </ProblemAlert>
      )}
      {previewed && <PolicyPreview preview={previewed} services={services} />}

      <PolicyVersions dealership={dealership} current={policy.data?.version} services={services} />

      <RuleDialog
        editing={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        others={rules.filter((rule) => !editing || editing.isNew || rule.code !== editing.rule.code)}
        services={services}
        onSave={(saved) => {
          edit(editing && !editing.isNew ? rules.map((rule) => (rule.code === editing.rule.code ? saved : rule)) : [...rules, saved])
          setEditing(null)
        }}
      />
    </>
  )
}

/** A 400's field errors (`rules[2].serviceCodes`) named by the rule they are about. */
function RuleErrors({ failure, sent }: { failure: unknown; sent: readonly RequirementRuleInput[] }) {
  const problem = parseProblem(failure)
  if (!problem || problemSlug(problem) !== "validation-error" || !problem.errors) return null
  return (
    <ul className="flex flex-col gap-0.5">
      {Object.entries(problem.errors).map(([path, messages]) => {
        const index = /^rules\[(\d+)\]/i.exec(path)?.[1]
        const rule = index !== undefined ? sent[Number(index)]?.code : undefined
        return <li key={path}>{`${rule ? `Rule ${rule}` : path}: ${messages.join(" ")}`}</li>
      })}
    </ul>
  )
}

function policyConflictRows(
  opened: AdminPolicyResponse,
  current: AdminPolicyResponse,
  mine: readonly RequirementRuleInput[],
  services: readonly ServiceTypeResponse[] | undefined
): ConflictRow[] {
  const theirs = ruleChanges(opened.rules, current.rules)
  const yours = ruleChanges(opened.rules, mine)
  const codes = [...new Set([...theirs.keys(), ...yours.keys()])].sort()
  const find = (rules: readonly RequirementRuleInput[], code: string) => rules.find((rule) => rule.code === code)
  const words = (rule: RequirementRuleInput | undefined) => (rule ? ruleSummary(rule, services) : "Not in this version")
  return codes.map((code) => ({
    key: code,
    label: code,
    opened: words(find(opened.rules, code)),
    now: words(find(current.rules, code)),
    yours: yours.has(code) ? words(find(mine, code)) : null,
  }))
}

interface RulesProps {
  rules: readonly RequirementRuleInput[]
  changes: ReadonlyMap<string, RuleChange>
  services: readonly ServiceTypeResponse[] | undefined
  onEdit: (rule: RequirementRuleInput) => void
  onRemove: (rule: RequirementRuleInput) => void
}

/** What a rule adds: its HV level (the badge with the ladder) and its equipment and certifications as the board's badges. */
function Needs({ rule }: { rule: RequirementRuleInput }) {
  const level = hvLevelOf(rule.minimumHvLevel)
  const none = (level === null || level === 0) && rule.bayCapabilities.length === 0 && rule.certifications.length === 0
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {level !== null && level > 0 && <HvLevelBadge level={level} />}
      <CapabilityBadges capabilities={rule.bayCapabilities} certifications={rule.certifications} max={4} className="flex-wrap" />
      {none && <span className="text-muted-foreground">Nothing more</span>}
    </span>
  )
}

function ChangeBadge({ change }: { change: RuleChange | undefined }) {
  if (!change || change === "removed") return null
  return change === "added" ? (
    <Badge variant="outline" className="border-signal font-normal text-signal">
      {changeLabel.added}
    </Badge>
  ) : (
    <Badge variant="secondary" className="font-normal">
      {changeLabel.changed}
    </Badge>
  )
}

function RuleActions({ rule, onEdit, onRemove }: { rule: RequirementRuleInput; onEdit: (rule: RequirementRuleInput) => void; onRemove: (rule: RequirementRuleInput) => void }) {
  return (
    <span className="flex justify-end gap-1">
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${rule.code}`} className="cursor-pointer" onClick={() => onEdit(rule)}>
        <Pencil aria-hidden="true" />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${rule.code}`} className="cursor-pointer text-destructive hover:text-destructive" onClick={() => onRemove(rule)}>
        <Trash2 aria-hidden="true" />
      </Button>
    </span>
  )
}

/**
 * The rules as a table (11.17's anatomy): order (`tabular-nums`), the rule's code (mono) with New or Changed in the draft,
 * when it applies in words, what it adds, and Edit and Remove (icon buttons named for the rule).
 */
function RuleTable({ rules, changes, services, onEdit, onRemove }: RulesProps) {
  return (
    <Table aria-label="Rules">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-16 pl-4 text-right">Order</TableHead>
          <TableHead>Rule</TableHead>
          <TableHead>Applies to</TableHead>
          <TableHead>Needs</TableHead>
          <TableHead className="w-px pr-4">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rules.map((rule) => (
          <TableRow key={rule.code} className={cn(changes.has(rule.code) && "bg-signal/5")}>
            <TableCell className="pl-4 text-right align-top text-muted-foreground tabular-nums">{rule.order}</TableCell>
            <TableCell className="align-top">
              <span className="flex flex-col items-start gap-1">
                <code className="font-mono text-xs tracking-wide">{rule.code}</code>
                <ChangeBadge change={changes.get(rule.code)} />
              </span>
            </TableCell>
            <TableCell className="max-w-md align-top whitespace-normal text-pretty">{whenWords(rule, services)}</TableCell>
            <TableCell className="align-top whitespace-normal">
              <Needs rule={rule} />
            </TableCell>
            <TableCell className="py-1 pr-4 align-top">
              <RuleActions rule={rule} onEdit={onEdit} onRemove={onRemove} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/**
 * The rules on a phone: one entry each in the card, divided by hairlines (a card inside the card would double the frame): the
 * code as a heading with New or Changed and the order, when it applies, then what it adds beside Edit and Remove (44 px).
 */
function RuleCards({ rules, changes, services, onEdit, onRemove }: RulesProps) {
  return (
    <ol aria-label="Rules" className="flex flex-col divide-y divide-border">
      {rules.map((rule) => (
        <li key={rule.code} className={cn("flex flex-col gap-2 px-4 py-3", changes.has(rule.code) && "bg-signal/5")}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-mono text-sm font-semibold tracking-wide">{rule.code}</h3>
              <ChangeBadge change={changes.get(rule.code)} />
            </div>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{`Order ${rule.order}`}</span>
          </div>
          <p className="text-sm text-pretty">{whenWords(rule, services)}</p>
          <div className="flex items-center justify-between gap-2">
            <Needs rule={rule} />
            <RuleActions rule={rule} onEdit={onEdit} onRemove={onRemove} />
          </div>
        </li>
      ))}
    </ol>
  )
}
