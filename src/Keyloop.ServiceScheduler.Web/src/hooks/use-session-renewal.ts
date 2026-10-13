import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useState, useSyncExternalStore } from "react"

import type { SessionRenewalState } from "@/contexts/session-renewal-context"
import { createSessionRenewal } from "@/lib/session-renewal"

/**
 * The tab's session renewal (lib/session-renewal.ts): renews the sign-in before it ends, or says when it ends or has
 * ended. Run once, by the root layout, which shares it with the pages' session banner.
 */
export function useSessionRenewal(): SessionRenewalState {
  const queryClient = useQueryClient()
  const [renewal] = useState(() => createSessionRenewal(queryClient))
  useEffect(() => renewal.start(), [renewal])
  const notice = useSyncExternalStore(renewal.subscribe, renewal.notice)
  return { notice, renew: renewal.renew, dismiss: renewal.dismiss }
}
