import { QueryClient } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest"

import type { CurrentUserResponse } from "@/api/types.gen"
import { currentUserQueryKey } from "@/lib/session"
import {
  browserNavigation,
  createSessionRenewal,
  LEASE_SETTLE_MS,
  RENEWAL_LEASE_KEY,
  RENEWAL_LEASE_MS,
  type SessionRenewal,
  type StorageArea,
} from "@/lib/session-renewal"
import { holdUnsavedWork } from "@/lib/unsaved-work"
import { expiringAt, serviceAdvisor } from "@/test/identities"

// The renewal's guards (Task 36, review round 1), one controller per page load over its own query cache: a tab keeps its
// sessionStorage across loads, every tab shares localStorage. Two minutes before 09:30 the sign-in is due for renewal.

const END = "2026-10-13T09:30:00Z"

/** A Storage over a map, as one tab's sessionStorage or the origin's shared localStorage. */
class MemoryStorage implements Storage {
  readonly items = new Map<string, string>()
  get length() {
    return this.items.size
  }
  clear() {
    this.items.clear()
  }
  getItem(key: string) {
    return this.items.get(key) ?? null
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.items.delete(key)
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value))
  }
}

/** Storage that refuses writes (a full quota, Safari's old private mode), or reading too (blocked site data). */
class RefusingStorage extends MemoryStorage {
  readonly refuseReads: boolean
  constructor(refuseReads: boolean) {
    super()
    this.refuseReads = refuseReads
  }
  override getItem(key: string) {
    if (this.refuseReads) throw new DOMException("The operation is insecure.", "SecurityError")
    return super.getItem(key)
  }
  override setItem(): void {
    throw new DOMException("The quota has been exceeded.", "QuotaExceededError")
  }
}

let navigate: MockInstance<(href: string) => void>
const stops: (() => void)[] = []
const releases: (() => void)[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-13T09:28:30Z"))
  navigate = vi.spyOn(browserNavigation, "assign").mockImplementation(() => {})
})
afterEach(() => {
  for (const stop of stops.splice(0)) stop()
  for (const release of releases.splice(0)) release()
  vi.useRealTimers()
})

interface Page {
  controller: SessionRenewal
  read: MockInstance<() => Promise<CurrentUserResponse>>
  stop: () => void
}

/**
 * Loads a page in a tab: a fresh query cache whose `/me` already answered `me()` (read just now), and a started renewal
 * over the tab's own storage and the shared one. Later reads of `/me` answer `me()` again.
 */
function load({
  session = new MemoryStorage(),
  shared = new MemoryStorage(),
  me = () => expiringAt(serviceAdvisor, END),
}: { session?: Storage; shared?: Storage; me?: () => CurrentUserResponse } = {}): Page {
  const read = vi.fn(async () => me())
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryDefaults(currentUserQueryKey(), { queryFn: read })
  client.setQueryData(currentUserQueryKey(), me())
  const area = (storage: Storage): StorageArea => () => storage
  const controller = createSessionRenewal(client, { session: area(session), shared: area(shared) })
  const stop = controller.start()
  stops.push(stop)
  return { controller, read, stop }
}

const passes = (ms: number) => vi.advanceTimersByTimeAsync(ms)
/** Long enough for a claim to settle. */
const LEASE_SETTLE = LEASE_SETTLE_MS + 50

describe("the automatic renewal's guards", () => {
  it.each([
    ["this tab's storage refuses writes", () => ({ session: new RefusingStorage(false) })],
    ["this tab's storage refuses reads and writes", () => ({ session: new RefusingStorage(true) })],
    ["the shared storage refuses writes", () => ({ shared: new RefusingStorage(false) })],
    ["the shared storage refuses reads and writes", () => ({ shared: new RefusingStorage(true) })],
  ])("never navigates on its own when %s, and still renews when asked", async (_, storages) => {
    const tab = { session: new MemoryStorage(), shared: new MemoryStorage(), ...storages() }
    const first = load(tab)
    await passes(1_000)
    expect(navigate).not.toHaveBeenCalled()
    expect(first.controller.notice()).toEqual({ kind: "ending", endsAt: Date.parse(END) })

    first.controller.renew()
    expect(navigate).toHaveBeenCalledTimes(1)
    first.stop()

    // The page that comes back cannot prove the guard either: it offers Stay signed in again, never a loop. (Where the
    // shared storage still works, the renewal's own lease makes it wait for that lease to end before it says so.)
    const second = load(tab)
    await passes(RENEWAL_LEASE_MS + 1_000)
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(second.controller.notice()?.kind).toBe("ending")
  })

  it("keeps the five-minute guard across reloads, and lets it expire only by time", async () => {
    const tab = { session: new MemoryStorage(), shared: new MemoryStorage() }
    const first = load(tab)
    await passes(LEASE_SETTLE)
    expect(navigate).toHaveBeenCalledTimes(1)
    first.stop()

    // The renewal came back still ending soon, then the page is reloaded at once.
    const returned = load(tab)
    await passes(1_000)
    expect(returned.controller.notice()?.kind).toBe("ending")
    returned.stop()
    const reloaded = load(tab)
    await passes(1_000)
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(reloaded.controller.notice()?.kind).toBe("ending")
    reloaded.stop()

    // Five minutes after that renewal, a sign-in due again is renewed on its own.
    vi.setSystemTime(new Date("2026-10-13T09:33:31Z"))
    load({ ...tab, me: () => expiringAt(serviceAdvisor, "2026-10-13T09:35:00Z") })
    await passes(LEASE_SETTLE)
    expect(navigate).toHaveBeenCalledTimes(2)
  })

  it.each(["focus", "online", "visibilitychange"])(
    "reads /me again once the API has stopped accepting the token, even after a %s look in between",
    async (event) => {
      releases.push(holdUnsavedWork())
      const page = load()
      await passes(90_000)
      expect(page.controller.notice()?.kind).toBe("ended")
      await passes(10_000)
      ;(event === "visibilitychange" ? document : window).dispatchEvent(new Event(event))
      await passes(49_000)
      expect(page.read).not.toHaveBeenCalled()
      await passes(1_100)
      expect(page.read).toHaveBeenCalledTimes(1)
      // Once: a server whose clock is behind cannot make it read for ever.
      await passes(5 * 60_000)
      expect(page.read).toHaveBeenCalledTimes(1)
    }
  )

  it("leaves an ending offered while offline to the person, through Not now and the reconnection", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    const page = load()
    await passes(1_000)
    expect(page.controller.notice()?.kind).toBe("ending")
    page.controller.dismiss()
    expect(page.controller.notice()).toBeNull()

    online.mockReturnValue(true)
    window.dispatchEvent(new Event("online"))
    await passes(1_000)
    expect(navigate).not.toHaveBeenCalled()
    expect(page.controller.notice()).toBeNull()
  })

  it("lets one tab renew for every tab sharing the cookie; the others read /me again when its lease ends", async () => {
    const shared = new MemoryStorage()
    let renewed = false
    const me = () => expiringAt(serviceAdvisor, renewed ? "2026-10-13T10:28:30Z" : END)
    const first = load({ shared, me })
    const second = load({ shared, me })
    await passes(LEASE_SETTLE)
    expect(navigate).toHaveBeenCalledTimes(1)

    // The first tab's renewal set the shared cookie; the second reads /me when the lease ends and finds it.
    renewed = true
    await passes(RENEWAL_LEASE_MS - LEASE_SETTLE - 100)
    expect(second.read).not.toHaveBeenCalled()
    await passes(200)
    expect(second.read).toHaveBeenCalledTimes(1)
    await passes(1_000)
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(second.controller.notice()).toBeNull()
    expect(first.read).not.toHaveBeenCalled()
  })

  it("offers Stay signed in at once, claiming nothing, when it cannot read this tab's guard", async () => {
    const shared = new MemoryStorage()
    const page = load({ session: new RefusingStorage(true), shared })
    // At once, without a claim on the lease other tabs would then wait for.
    expect(page.controller.notice()?.kind).toBe("ending")
    expect(shared.getItem(RENEWAL_LEASE_KEY)).toBeNull()
  })

  it("claims again when its lease is gone after it settled (another tab gave up and removed it)", async () => {
    const shared = new MemoryStorage()
    load({ shared })
    await passes(LEASE_SETTLE_MS / 2)
    shared.removeItem(RENEWAL_LEASE_KEY)
    await passes(LEASE_SETTLE_MS / 2 + 10)
    expect(navigate).not.toHaveBeenCalled()
    expect(JSON.parse(shared.getItem(RENEWAL_LEASE_KEY) ?? "null")).toMatchObject({ at: Date.now() - 10 })
    await passes(LEASE_SETTLE)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it("gives way when another tab claims the lease while this one's claim settles", async () => {
    const shared = new MemoryStorage()
    load({ shared })
    await passes(LEASE_SETTLE / 2)
    shared.setItem(RENEWAL_LEASE_KEY, JSON.stringify({ tab: "another-tab", at: Date.now() }))
    await passes(LEASE_SETTLE)
    expect(navigate).not.toHaveBeenCalled()
  })
})
