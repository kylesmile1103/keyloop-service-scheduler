import { hashKey, type QueryClient } from "@tanstack/react-query"

import { failureStatus } from "@/lib/problem-details"
import { cachedIdentity, currentUserQueryKey, signInHref } from "@/lib/session"
import { hasUnsavedWork } from "@/lib/unsaved-work"

/**
 * Keeping a signed-in user signed in (ADR-027, "Session renewal"). Cloudflare Access issues no refresh token: the API
 * validates the application token (the hostname's HttpOnly `CF_Authorization` cookie, short-lived by design) until its
 * `exp`, which `/me` reports as `expiresAtUtc`. While the Access account session on the team domain lasts, a top-level
 * visit to the API's login path issues a new application token without asking anything and comes back to the page. A
 * script cannot do that (the team domain's cookies are third-party to a frame or a fetch), so renewing is a navigation and
 * the page loads again.
 *
 * For a tab whose `/me` carries an expiry:
 * - two minutes before it, `/me` is read again (another tab may already have renewed the shared cookie); then, if no view
 *   holds unsaved work (lib/unsaved-work.ts) and the browser is online, the tab renews on its own;
 * - otherwise it says when the sign-in ends and offers *Stay signed in* (the same navigation), and leaves that sign-in's
 *   renewal to the person;
 * - once the sign-in has ended (its expiry passed, `/me` turned anonymous after being signed in, or a write was refused with
 *   `401`) it says so and offers *Sign in again*.
 * A tab never renews on its own twice within five minutes, so a renewal that did not help (a page that comes back still
 * expiring soon, an application session shorter than the lead) cannot loop. Timers sleep in background tabs and on a
 * sleeping device, so a tab looks again when it becomes visible, regains focus, comes back online or is restored from the
 * back-forward cache. Nothing here reads or stores a token: it reads `/me`, and remembers for this tab only that it
 * navigated to renew. The identity rules are untouched: a renewal that comes back as the same caller changes nothing
 * (`identityKey` holds no expiry), and an ended session is the anonymous identity that SessionWatch already answers.
 */

/** How long before the sign-in ends a tab renews it. */
export const RENEW_BEFORE_MS = 2 * 60_000
/** The shortest time between two renewals a tab starts on its own. */
export const AUTOMATIC_RENEWAL_INTERVAL_MS = 5 * 60_000
/** The API still accepts a token this long after its `exp` (`Auth:ClockSkew`, at most a minute); `/me` is read again then. */
export const SERVER_CLOCK_SKEW_MS = 60_000
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

/** Remembers across the renewal's navigation, for this tab only, when it left (epoch ms). */
const RENEWAL_KEY = "keyloop-scheduler-renewal"

function rememberedRenewal(): number | null {
  try {
    const at = Number(sessionStorage.getItem(RENEWAL_KEY))
    return Number.isFinite(at) && at > 0 ? at : null
  } catch {
    return null
  }
}

function writeRenewal(at: number | null): void {
  try {
    if (at === null) sessionStorage.removeItem(RENEWAL_KEY)
    else sessionStorage.setItem(RENEWAL_KEY, String(at))
  } catch {
    // Storage refused (a private window, blocked site data): the renewal still happens; the page that comes back just
    // does not know it was one.
  }
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
export function createSessionRenewal(queryClient: QueryClient): SessionRenewal {
  const meKey = currentUserQueryKey()
  const meHash = hashKey(meKey)
  // When this page was reached by a renewal's navigation, if it was: its first answer says whether that helped.
  let renewedAt = rememberedRenewal()
  let returning = renewedAt !== null
  let wasSignedIn = returning
  // The expiry whose renewal is left to the person (they were offered Stay signed in), and the one already read again
  // after it passed (once, so a server whose clock is behind cannot make it read for ever).
  let heldFor: number | null = null
  let rereadFor: number | null = null
  let renewing = false
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

  function later(at: number, run: () => void) {
    timers.push(setTimeout(run, Math.min(Math.max(at - Date.now(), 0), 2_147_483_647)))
  }

  function clearTimers() {
    for (const timer of timers) clearTimeout(timer)
    timers = []
  }

  const readAgain = () => void queryClient.refetchQueries({ queryKey: meKey, exact: true }, { cancelRefetch: false })

  function evaluate() {
    if (renewing) return
    const user = cachedIdentity(queryClient)
    // Nobody known yet, or the last read failed (the user menu says so): what is shown and scheduled stays.
    if (!user) return
    clearTimers()
    if (returning) {
      returning = false
      writeRenewal(null)
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
    const now = Date.now()
    if (now >= expiresAt) {
      show(ENDED)
      // Once the API stops accepting the token, `/me` is read again, so every view agrees (or finds another tab's renewal).
      if (rereadFor !== expiresAt) {
        rereadFor = expiresAt
        later(expiresAt + SERVER_CLOCK_SKEW_MS, readAgain)
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
    const automatic = heldFor !== expiresAt && (renewedAt === null || now - renewedAt >= AUTOMATIC_RENEWAL_INTERVAL_MS)
    if (automatic && !hasUnsavedWork()) {
      // Offline, the navigation would only reach the browser's error page: wait for the connection (the `online` event).
      if (navigator.onLine !== false) {
        renew()
        return
      }
    } else heldFor = expiresAt
    show({ kind: "ending", endsAt: expiresAt })
  }

  function renew() {
    renewing = true
    clearTimers()
    renewedAt = Date.now()
    writeRenewal(renewedAt)
    browserNavigation.assign(renewalHref())
    // Still here: the navigation was stopped or never started. Look again, offering Stay signed in rather than retrying.
    later(renewedAt + NAVIGATION_GRACE_MS, () => {
      renewing = false
      evaluate()
    })
  }

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
      window.addEventListener("focus", evaluate)
      window.addEventListener("online", evaluate)
      window.addEventListener("pageshow", restored)
      evaluate()
      return () => {
        clearTimers()
        stopQueries()
        stopMutations()
        document.removeEventListener("visibilitychange", visible)
        window.removeEventListener("focus", evaluate)
        window.removeEventListener("online", evaluate)
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
