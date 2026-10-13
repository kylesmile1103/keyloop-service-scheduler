import { useEffect } from "react"

import { holdUnsavedWork } from "@/lib/unsaved-work"

/** Holds an unsaved-work lock while `active` is true so automatic session renewal does not navigate away. */
export function useUnsavedWork(active: boolean): void {
  useEffect(() => (active ? holdUnsavedWork() : undefined), [active])
}
