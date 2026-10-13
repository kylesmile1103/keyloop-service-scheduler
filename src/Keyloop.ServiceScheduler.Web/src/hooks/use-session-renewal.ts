import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useState, useSyncExternalStore } from "react"

import type { SessionRenewalState } from "@/contexts/session-renewal-context"
import { createSessionRenewal } from "@/lib/session-renewal"

/** Starts and subscribes to the tab's session renewal controller from the root layout. */
export function useSessionRenewal(): SessionRenewalState {
  const queryClient = useQueryClient()
  const [renewal] = useState(() => createSessionRenewal(queryClient))
  useEffect(() => renewal.start(), [renewal])
  const notice = useSyncExternalStore(renewal.subscribe, renewal.notice)
  return { notice, renew: renewal.renew, dismiss: renewal.dismiss }
}
