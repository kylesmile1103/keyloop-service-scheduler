import { hashKey, type QueryClient } from "@tanstack/react-query"

import { failureStatus } from "@/lib/problem-details"
import { cachedIdentity, currentUserQueryKey, signInHref } from "@/lib/session"
import { hasUnsavedWork } from "@/lib/unsaved-work"

/**
 * Keeping a signed-in user signed in (ADR-027, "Session duration and renewal"). Cloudflare Access issues no refresh token:
 * the API validates the application token (the hostname's HttpOnly `CF_Authorization` cookie, short-lived by design)
 * until its `exp`, which `/me` reports as `expiresAtUtc`. While the Access account session on the team domain lasts, a
 * top-level visit to the API's login path issues a new application token without asking anything and comes back to the
 * page. A script cannot do that (the team domain's cookies are third-party to a frame or a fetch), so renewing is a
 * navigation and the page loads again.
 *
 * For a tab whose `/me` carries an expiry:
 * - two minutes before it, `/me` is read again (another tab may already have renewed the shared cookie); then the tab
 *   renews on its own only when no view holds unsaved work (lib/unsaved-work.ts), the browser is online, it can prove it
 *   did not renew on its own in the last five minutes (a guard it writes and reads back in this tab's `sessionStorage`
 *   before navigating, kept across page loads until it expires) and no other tab is renewing (a 30-second lease in
 *   `localStorage`, checked and claimed under an origin-wide Web Lock where the browser has them, so exactly one tab
 *   renews; the others read `/me` again when it ends and find the new expiry);
 * - otherwise it says when the sign-in ends and offers *Stay signed in* (the same navigation), and that sign-in's renewal
 *   is the person's from then on, whatever happens next (a reconnection, a refocus, the work being put away);
 * - once the sign-in has ended (its expiry passed, `/me` turned anonymous after being signed in, or a write was refused with
 *   `401`) it says so and offers *Sign in again*, and `/me` is read again once the API has stopped accepting the token.
 * Storage that cannot be written or read back (a private window, blocked site data, a full quota) never lets the tab
 * navigate on its own: the person decides. So a renewal that did not help cannot loop. Timers sleep in background tabs and
 * on a sleeping device, so a tab looks again when it becomes visible, regains focus, comes back online or is restored
 * from the back-forward cache. Without Web Locks the lease is claimed and re-checked after 300 ms, which keeps two tabs
 * apart in ordinary timing; a tab paused between its check and its claim, or tabs whose clocks disagree, can still both
 * renew, which is harmless (two new cookies; each tab still renews on its own at most once per guard window). Nothing
 * here reads or stores a token: it reads `/me` and stores timestamps, an expiry and the renewing tab's random id. The
 * identity rules are untouched: a renewal that comes back as the same caller changes nothing (`identityKey` holds no
 * expiry), and an ended session is the anonymous identity that SessionWatch already answers.
 */

/** How long before the sign-in ends a tab renews it. */
export const RENEW_BEFORE_MS = 2 * 60_000
/** The shortest time between two renewals a tab starts on its own. */
export const AUTOMATIC_RENEWAL_INTERVAL_MS = 5 * 60_000
/** The API still accepts a token this long after its `exp` (`Auth:ClockSkew`, at most a minute); `/me` is read again then. */
export const SERVER_CLOCK_SKEW_MS = 60_000
/** How long a tab's claim to renew for every tab holds: about one renewal's round trip through Access. */
export const RENEWAL_LEASE_MS = 30_000
/** Without Web Locks: how long a tab waits after writing its claim before trusting it, so two claims at once see one winner. */
export const LEASE_SETTLE_MS = 300
/** The Web Lock under which a tab checks and claims the lease: one name for the origin, held only for that decision. */
export const RENEWAL_LOCK = "keyloop-scheduler-renewal"
/** A renewal's navigation that has not left the page by then did not happen (stopped, or blocked): the tab looks again. */
const NAVIGATION_GRACE_MS = 30_000

/** What the session banner says: the sign-in ends at `endsAt` (epoch ms) while work is open, or it has ended. */
export type SessionNotice = { kind: "ending"; endsAt: number } | { kind: "ended" }

const ENDED: SessionNotice = { kind: "ended" }

/** The browser's navigation, behind a seam the tests replace (jsdom's `location.assign` cannot be spied on). */
export const browserNavigation = { assign: (href: string) => window.location.assign(href) }

/** Where a renewal goes: the API's login path on this origin, coming back to this page (its path, search and hash). */
export function renewalHref(): string {
  const { pathname, search, hash } = window.location
  return signInHref(`${pathname}${search}${hash}`)
}

/**
 * This tab's last renewal (sessionStorage, so it survives the navigation and later reloads but is never shared): when it
 * left (epoch ms), and whether the next page has yet to see it (`returning`: that page was reached by the renewal).
 */
export const RENEWAL_GUARD_KEY = "keyloop-scheduler-renewal"
/**
 * Which tab is renewing for every tab sharing the cookie (localStorage): its random id, when it claimed (epoch ms, on its
 * own clock) and the expiry it is renewing.
 */
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

/** A storage area as the browser gives it: reaching it can throw too (blocked site data), so it is asked for each time. */
export type StorageArea = () => Storage

/**
 * A stored value: `undefined` when there is none (or it is not one of ours), `null` when the storage cannot be read, so a
 * caller can tell "nothing there" from "cannot know".
 */
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

/** Writes a value and reads it back: `true` only when the storage now holds exactly it. */
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
    // Nothing to do: a lease that cannot be removed runs out on its own.
  }
}

export interface SessionRenewalOptions {
  /** This tab's own storage (the guard). By default the page's `sessionStorage`. */
  session?: StorageArea
  /** The storage every tab of the origin shares (the lease). By default the page's `localStorage`. */
  shared?: StorageArea
  /** This tab's id in the lease. By default a random UUID. */
  tab?: string
  /** The origin's Web Locks, when the browser has them. By default `navigator.locks`. */
  locks?: () => LockManager | undefined
  /** This tab's clock (`now`, epoch ms) and its own elapsed time (`elapsed`, monotonic ms). By default `Date` and `performance`. */
  clock?: { now: () => number; elapsed: () => number }
}

export interface SessionRenewal {
  /** Starts watching `/me`, the mutations' refusals, the timers and the window's events; returns the stop. */
  start(): () => void
  subscribe(listener: () => void): () => void
  /** What to show now (the same object until it changes), or nothing. */
  notice(): SessionNotice | null
  /** *Stay signed in*, *Sign in again*: renews now, by navigating. */
  renew(): void
  /** *Not now*: hides what is shown until there is something else to say. */
  dismiss(): void
}

/** The session renewal of one tab, over the app's query cache (see above). */
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
  // Whether this page has had its first answer (which consumes a returning guard), and whether the tab was signed in.
  let answered = false
  let wasSignedIn = false
  // The expiry whose renewal is the person's (they were offered Stay signed in), and the expiry whose read after its end
  // has run (once, so a server whose clock is behind cannot make it read for ever; until it runs, every look reschedules it).
  let heldFor: number | null = null
  let rereadFor: number | null = null
  // A renewal's navigation has started; this tab's claim to renew is settling, or has settled (without Web Locks).
  let renewing = false
  let settling: ReturnType<typeof setTimeout> | null = null
  let settled = false
  // With Web Locks: a request for the lock is out (its ticket; a stop or a newer request makes an older one stale), this
  // look runs under the lock, or the browser refused the lock (the lease alone then).
  let started = false
  let deciding: number | null = null
  let tickets = 0
  let locked = false
  let lockRefused = false
  // Another tab's lease as this tab first saw it, by this tab's own elapsed time, for the waits that cannot trust clocks.
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

  /** Offers Stay signed in for this expiry, which from then on is never renewed on the tab's own. */
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

  /**
   * Until when (this tab's clock) another tab's lease keeps this one from renewing `expiresAt`, or `null` once it is over.
   * A lease fresh on this tab's clock holds until its end. One dated ahead of this clock, or one for this very expiry that
   * looks old here, means the tabs' clocks disagree: it holds for a lease's length of this tab's own elapsed time from the
   * moment it first saw it, then counts as abandoned.
   */
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

  /**
   * Whether this tab may renew `expiresAt` on its own now: `manual` when it cannot prove it did not within five minutes (a
   * recent guard, or storage it cannot read), `wait` while another tab's lease holds, else `claim` (`ours` when the lease
   * already names this tab).
   */
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

  /**
   * Asks for the origin-wide lock, without waiting for it, and looks again holding it: the check and the claim are then one
   * step no other tab can split. A tab that does not get it (another is deciding this moment) reads `/me` again once that
   * tab's lease would end. A browser that refuses the lock leaves the lease alone to keep tabs apart.
   */
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
