import { createContext } from "react"

import type { SessionNotice } from "@/lib/session-renewal"

/** The tab's session renewal (hooks/use-session-renewal), shared from the root layout with every page's session banner. */
export interface SessionRenewalState {
  /** What the banner says now, or nothing. */
  notice: SessionNotice | null
  /** *Stay signed in*, *Sign in again*: renews now, by navigating. */
  renew: () => void
  /** *Not now*: hides the banner until there is something else to say. */
  dismiss: () => void
}

/** `null` outside the root layout (a view rendered on its own): no banner. */
export const SessionRenewalContext = createContext<SessionRenewalState | null>(null)
