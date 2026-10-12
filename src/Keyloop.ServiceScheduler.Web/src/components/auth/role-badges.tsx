import { Eye, ShieldCheck, Wrench } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { ROLE_LABELS, type Role } from "@/lib/session"
import { cn } from "@/lib/utils"

const icons: Record<Role, typeof Eye> = { Admin: ShieldCheck, ServiceAdvisor: Wrench, Viewer: Eye }

/** An account's API roles as outline badges, each with its icon and name; "No role" for an account without one. */
export function RoleBadges({ roles, className }: { roles: readonly Role[]; className?: string }) {
  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {roles.length === 0 ? (
        <Badge variant="outline" className="text-muted-foreground">
          No role
        </Badge>
      ) : (
        roles.map((role) => {
          const Icon = icons[role]
          return (
            <Badge key={role} variant="outline">
              <Icon aria-hidden="true" />
              {ROLE_LABELS[role]}
            </Badge>
          )
        })
      )}
    </span>
  )
}
