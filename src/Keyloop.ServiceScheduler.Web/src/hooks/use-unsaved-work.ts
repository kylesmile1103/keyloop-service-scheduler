import { useEffect } from "react"

import { holdUnsavedWork } from "@/lib/unsaved-work"

/**
 * Says the view has work a session renewal's navigation would lose (lib/unsaved-work.ts) while `active` is true; the claim
 * goes when it turns false or the view unmounts.
 */
export function useUnsavedWork(active: boolean): void {
  useEffect(() => (active ? holdUnsavedWork() : undefined), [active])
}
