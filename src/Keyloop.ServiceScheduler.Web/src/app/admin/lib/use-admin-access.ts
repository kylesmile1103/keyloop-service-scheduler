import { useCurrentUser } from "@/hooks/use-current-user"
import { adminOnlyReason } from "@/lib/session"

/**
 * Who may change what the Resources area lists (Task 30b, UI_DESIGN 11.20 and 11.24): an Admin edits; a Service advisor or
 * a Viewer sees the same lists read-only, the edit actions on screen but unavailable, with the reason. The layout already
 * keeps out a visitor (the 401 page) and an account without a role (the 403 page), so these are the only two cases here.
 */
export function useAdminAccess(what: string): { admin: boolean; reason: string } {
  const current = useCurrentUser()
  return { admin: current.isAdmin, reason: adminOnlyReason(what) }
}
