import { createContext } from "react"

import type { SessionNotice } from "@/lib/session-renewal"

/** Session renewal state shared from the root layout with page session banners. */
export interface SessionRenewalState {
  notice: SessionNotice | null
  renew: () => void
  dismiss: () => void
}

export const SessionRenewalContext = createContext<SessionRenewalState | null>(null)
