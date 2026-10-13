import { hashKey, type QueryClient } from "@tanstack/react-query"

import { failureStatus } from "@/lib/problem-details"
import { cachedIdentity, currentUserQueryKey, signInHref } from "@/lib/session"
import { hasUnsavedWork } from "@/lib/unsaved-work"

/** How long before expiry a tab attempts to renew the session. */
export const RENEW_BEFORE_MS = 2 * 60_000
/** Minimum interval between automatic renewals initiated by the same tab. */
export const AUTOMATIC_RENEWAL_INTERVAL_MS = 5 * 60_000
/** Server clock skew allowance after `exp` before re-reading `/me`. */
export const SERVER_CLOCK_SKEW_MS = 60_000
/** Duration of the cross-tab renewal lease in `localStorage`. */
export const RENEWAL_LEASE_MS = 30_000
/** Settle delay after writing a lease when Web Locks are unavailable. */
export const LEASE_SETTLE_MS = 300
/** Web Lock name used to coordinate cross-tab session renewal. */
export const RENEWAL_LOCK = "keyloop-scheduler-renewal"
const NAVIGATION_GRACE_MS = 30_000

/** Session banner notice state: expiring soon at `endsAt` (epoch ms) or already ended. */
export type SessionNotice = { kind: "ending"; endsAt: number } | { kind: "ended" }

const ENDED: SessionNotice = { kind: "ended" }

export const browserNavigation = { assign: (href: string) => window.location.assign(href) }

/** Returns the same-origin login URL that returns to the current path, search, and hash. */
export function renewalHref(): string {
  const { pathname, search, hash } = window.location
  return signInHref(`${pathname}${search}${hash}`)
}

/** `sessionStorage` key tracking this tab's last renewal timestamp and return state. */
export const RENEWAL_GUARD_KEY = "keyloop-scheduler-renewal"
/** `localStorage` key coordinating which tab is actively renewing the shared session cookie. */
export const RENEWAL_LEASE_KEY = "keyloop-scheduler-renewal-lease"

interface Guard {
  at: number
  returning: boolean
}

interface Lease {
  tab: string
  at: number
  expiry?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null
const isGuard = (value: unknown): value is Guard =>
  isRecord(value) && typeof value.at === "number" && Number.isFinite(value.at) && typeof value.returning === "boolean"
const isLease = (value: unknown): value is Lease =>
  isRecord(value) &&
  typeof value.tab === "string" &&
  typeof value.at === "number" &&
  Number.isFinite(value.at) &&
  (value.expiry === undefined || (typeof value.expiry === "number" && Number.isFinite(value.expiry)))

export type StorageArea = () => Storage

function readValue<T>(area: StorageArea, key: string, valid: (value: unknown) => value is T): T | undefined | null {
  try {
    const text = area().getItem(key)
    if (text === null) return undefined
    const value: unknown = JSON.parse(text)
    return valid(value) ? value : undefined
  } catch (error) {
    return error instanceof SyntaxError ? undefined : null
  }
}

function writeValue(area: StorageArea, key: string, value: Guard | Lease): boolean {
  const text = JSON.stringify(value)
  try {
    area().setItem(key, text)
    return area().getItem(key) === text
  } catch {
    return false
  }
}

function removeValue(area: StorageArea, key: string): void {
  try {
    area().removeItem(key)
  } catch {
    // Ignore storage removal errors; expired leases age out automatically.
  }
}

export interface SessionRenewalOptions {
  session?: StorageArea
  shared?: StorageArea
  tab?: string
  locks?: () => LockManager | undefined
  clock?: { now: () => number; elapsed: () => number }
}

export interface SessionRenewal {
  start(): () => void
  subscribe(listener: () => void): () => void
  notice(): SessionNotice | null
  renew(): void
  dismiss(): void
}

/** Creates a controller that monitors `/me` expiry and coordinates automatic or manual session renewal. */
export function createSessionRenewal(
  queryClient: QueryClient,
  {
    session = () => window.sessionStorage,
    shared = () => window.localStorage,
    tab = crypto.randomUUID(),
    locks = () => navigator.locks,
    clock = { now: () => Date.now(), elapsed: () => performance.now() },
  }: SessionRenewalOptions = {}
): SessionRenewal {
  const meKey = currentUserQueryKey()
  const meHash = hashKey(meKey)
  let answered = false
  let wasSignedIn = false
  let heldFor: number | null = null
  let rereadFor: number | null = null
  let renewing = false
  let settling: ReturnType<typeof setTimeout> | null = null
  let settled = false
  let started = false
  let deciding: number | null = null
  let tickets = 0
  let locked = false
  let lockRefused = false
  let sighting: { key: string; since: number } | null = null
  let current: SessionNotice | null = null
  let dismissed: SessionNotice | null = null
  let shown: SessionNotice | null = null
  let timers: ReturnType<typeof setTimeout>[] = []
  const listeners = new Set<() => void>()

  const same = (a: SessionNotice | null, b: SessionNotice | null) =>
    a === b || (a !== null && b !== null && a.kind === b.kind && (a.kind === "ended" || (b.kind === "ending" && a.endsAt === b.endsAt)))

  function publish() {
    const visible = current !== null && !same(current, dismissed) ? current : null
    if (visible === shown) return
    shown = visible
    for (const listener of listeners) listener()
  }

  function show(next: SessionNotice | null) {
    if (same(next, current)) return
    current = next
    if (next === null) dismissed = null
    publish()
  }

  function hold(expiresAt: number) {
    heldFor = expiresAt
    show({ kind: "ending", endsAt: expiresAt })
  }

  function later(at: number, run: () => void) {
    timers.push(setTimeout(run, Math.min(Math.max(at - clock.now(), 0), 2_147_483_647)))
  }

  function clearTimers() {
    for (const timer of timers) clearTimeout(timer)
    timers = []
  }

  function stopSettling() {
    if (settling !== null) clearTimeout(settling)
    settling = null
    settled = false
  }

  const readAgain = () => void queryClient.refetchQueries({ queryKey: meKey, exact: true }, { cancelRefetch: false })
  const readGuard = () => readValue(session, RENEWAL_GUARD_KEY, isGuard)
  const readLease = () => readValue(shared, RENEWAL_LEASE_KEY, isLease)

  /** Returns the timestamp until which another tab's lease blocks automatic renewal for `expiresAt`, or `null`. */
  function heldUntil(lease: Lease, expiresAt: number, now: number): number | null {
    if (lease.tab === tab) return null
    const key = `${lease.tab}|${lease.at}`
    if (sighting?.key !== key) sighting = { key, since: clock.elapsed() }
    const age = now - lease.at
    if (age >= 0 && age < RENEWAL_LEASE_MS) return lease.at + RENEWAL_LEASE_MS
    if (age < 0 || lease.expiry === expiresAt) {
      const left = RENEWAL_LEASE_MS - (clock.elapsed() - sighting.since)
      if (left > 0) return now + left
    }
    return null
  }

  function automatic(
    now: number,
    expiresAt: number
  ): { kind: "manual" } | { kind: "wait"; until: number } | { kind: "claim"; ours: boolean } {
    const guard = readGuard()
    if (guard === null || (guard !== undefined && Math.abs(now - guard.at) < AUTOMATIC_RENEWAL_INTERVAL_MS)) return { kind: "manual" }
    const lease = readLease()
    if (lease === null) return { kind: "manual" }
    const until = lease === undefined ? null : heldUntil(lease, expiresAt, now)
    if (until !== null) return { kind: "wait", until }
    return { kind: "claim", ours: lease?.tab === tab }
  }

  function decideUnderLock(manager: LockManager) {
    const ticket = ++tickets
    deciding = ticket
    const fallBack = () => {
      if (deciding !== ticket) return
      deciding = null
      lockRefused = true
      evaluate()
    }
    try {
      manager
        .request(RENEWAL_LOCK, { ifAvailable: true }, (lock) => {
          if (deciding !== ticket || !started) return
          deciding = null
          if (lock === null) {
            later(clock.now() + RENEWAL_LEASE_MS, readAgain)
            return
          }
          locked = true
          try {
            evaluate()
          } finally {
            locked = false
          }
        })
        .catch(fallBack)
    } catch {
      fallBack()
    }
  }

  /**
   * Claims the lease, then looks again once it has settled, so two tabs that claimed at once both see the one that wrote
   * last: still this tab's, it renews; another tab's, it waits.
   */
  function claim(expiresAt: number) {
    if (!writeValue(shared, RENEWAL_LEASE_KEY, { tab, at: clock.now(), expiry: expiresAt })) {
      hold(expiresAt)
      return
    }
    settling = setTimeout(() => {
      settling = null
      settled = true
      evaluate()
    }, LEASE_SETTLE_MS)
  }

  function evaluate() {
    if (renewing || settling !== null || deciding !== null) return
    const claimed = settled
    settled = false
    const user = cachedIdentity(queryClient)
    // Nobody known yet, or the last read failed (the user menu says so): what is shown and scheduled stays.
    if (!user) return
    clearTimers()
    if (!answered) {
      answered = true
      // This page was reached by a renewal: it was signed in. The guard itself stays until it expires.
      const guard = readGuard()
      if (guard?.returning) {
        wasSignedIn = true
        writeValue(session, RENEWAL_GUARD_KEY, { at: guard.at, returning: false })
      }
    }
    if (!user.authenticated) {
      show(wasSignedIn ? ENDED : null)
      return
    }
    wasSignedIn = true
    const expiresAt = user.expiresAtUtc ? Date.parse(user.expiresAtUtc) : Number.NaN
    // No expiry: the Development identity, which is configuration and never ends.
    if (Number.isNaN(expiresAt)) {
      show(null)
      return
    }
    const now = clock.now()
    if (now >= expiresAt) {
      show(ENDED)
      // Once the API stops accepting the token, `/me` is read again, so every view agrees (or finds another tab's renewal).
      if (rereadFor !== expiresAt) {
        later(expiresAt + SERVER_CLOCK_SKEW_MS, () => {
          rereadFor = expiresAt
          readAgain()
        })
      }
      return
    }
    const renewAt = expiresAt - RENEW_BEFORE_MS
    if (now < renewAt) {
      show(null)
      later(renewAt, evaluate)
      return
    }
    later(expiresAt, evaluate)
    // First make sure the sign-in still ends then: another tab may have renewed the cookie this tab shares.
    if ((queryClient.getQueryState(meKey)?.dataUpdatedAt ?? 0) < renewAt) {
      readAgain()
      return
    }
    // Offline, the navigation would only reach the browser's error page: the person decides, as with work open.
    if (heldFor === expiresAt || hasUnsavedWork() || navigator.onLine === false) {
      hold(expiresAt)
      return
    }
    const next = automatic(now, expiresAt)
    if (next.kind === "wait") {
      later(next.until, readAgain)
      return
    }
    if (next.kind === "claim") {
      const manager = lockRefused ? undefined : lockManager()
      if (manager && !locked) {
        decideUnderLock(manager)
        return
      }
      // Under the lock the claim is this step's (written and read back); without one it must have settled as this tab's.
      if (locked) {
        if (!writeValue(shared, RENEWAL_LEASE_KEY, { tab, at: now, expiry: expiresAt })) {
          hold(expiresAt)
          return
        }
      } else if (!(claimed && next.ours)) {
        claim(expiresAt)
        return
      }
      // The guard must be in place, and read back, before the tab leaves: the page that comes back relies on it.
      if (writeValue(session, RENEWAL_GUARD_KEY, { at: now, returning: true })) {
        navigate()
        return
      }
      removeValue(shared, RENEWAL_LEASE_KEY)
    }
    hold(expiresAt)
  }

  /** The browser's Web Locks, if it has them and lets this page use them. */
  function lockManager(): LockManager | undefined {
    try {
      return locks() ?? undefined
    } catch {
      return undefined
    }
  }

  function navigate() {
    renewing = true
    clearTimers()
    stopSettling()
    browserNavigation.assign(renewalHref())
    // Still here: the navigation was stopped or never started. Look again (the guard now offers Stay signed in).
    later(clock.now() + NAVIGATION_GRACE_MS, () => {
      renewing = false
      evaluate()
    })
  }

  /** The person's renewal: always navigates, recording what it can so the page that comes back and other tabs know. */
  function renew() {
    const at = clock.now()
    const user = cachedIdentity(queryClient)
    const expiry = user?.expiresAtUtc ? Date.parse(user.expiresAtUtc) : Number.NaN
    writeValue(session, RENEWAL_GUARD_KEY, { at, returning: true })
    writeValue(shared, RENEWAL_LEASE_KEY, Number.isNaN(expiry) ? { tab, at } : { tab, at, expiry })
    navigate()
  }

  const check = () => evaluate()

  return {
    start() {
      const stopQueries = queryClient.getQueryCache().subscribe((event) => {
        if (event.type === "updated" && event.query.queryHash === meHash && event.action.type === "success") evaluate()
      })
      // A write the API refused with 401: the session ended on the server (SessionWatch reads `/me` again, which agrees).
      const stopMutations = queryClient.getMutationCache().subscribe((event) => {
        if (event.type === "updated" && event.action.type === "error" && failureStatus(event.action.error) === 401 && wasSignedIn) {
          show(ENDED)
        }
      })
      const visible = () => {
        if (document.visibilityState === "visible") evaluate()
      }
      // Restored from the back-forward cache after a renewal's navigation: this page is current again, and `/me` may not be.
      const restored = (event: PageTransitionEvent) => {
        if (!event.persisted) return
        renewing = false
        readAgain()
      }
      document.addEventListener("visibilitychange", visible)
      window.addEventListener("focus", check)
      window.addEventListener("online", check)
      window.addEventListener("pageshow", restored)
      started = true
      evaluate()
      return () => {
        started = false
        deciding = null
        clearTimers()
        stopSettling()
        stopQueries()
        stopMutations()
        document.removeEventListener("visibilitychange", visible)
        window.removeEventListener("focus", check)
        window.removeEventListener("online", check)
        window.removeEventListener("pageshow", restored)
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    notice: () => shown,
    renew,
    dismiss() {
      dismissed = current
      publish()
    },
  }
}
