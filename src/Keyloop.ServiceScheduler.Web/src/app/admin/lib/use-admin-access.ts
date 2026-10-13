import { useCurrentUser } from "@/hooks/use-current-user"
import { adminOnlyReason } from "@/lib/session"

/** Returns whether the current user has Admin write access and the read-only explanation for other roles. */
export function useAdminAccess(what: string): { admin: boolean; reason: string } {
  const current = useCurrentUser()
  return { admin: current.isAdmin, reason: adminOnlyReason(what) }
}
