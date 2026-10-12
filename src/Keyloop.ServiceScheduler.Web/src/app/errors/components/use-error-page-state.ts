import { useLocation } from "react-router-dom"

import type { ErrorPageState } from "@/lib/error-pages"

/** The navigation state an error page was opened with, if any. */
export function useErrorPageState(): ErrorPageState {
  const state: unknown = useLocation().state
  if (typeof state !== "object" || state === null) return {}
  const { from, traceId } = state as Record<string, unknown>
  return { from: typeof from === "string" ? from : undefined, traceId: typeof traceId === "string" ? traceId : undefined }
}
