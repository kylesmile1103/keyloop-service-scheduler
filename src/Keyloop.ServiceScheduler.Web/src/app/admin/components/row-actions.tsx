import { History, type LucideIcon, MoreHorizontal } from "lucide-react"
import { useRef } from "react"
import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/** One action of a row's menu; `trigger` is the menu's button, where focus returns from what the action opens. */
export interface RowAction {
  label: string
  icon: LucideIcon
  destructive?: boolean
  onSelect: (trigger: HTMLElement) => void
}

/**
 * A technician's or bay's actions for an Admin (UI_DESIGN 11.24, the appointments list's row menu): a ghost icon button
 * named for the resource ("Actions for Ben Okafor", 44 px on touch), the actions, then a separator and the resource's
 * change history (a router link).
 */
export function RowActions({ name, actions, historyHref }: { name: string; actions: readonly RowAction[]; historyHref: string }) {
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button ref={trigger} type="button" variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`} className="cursor-pointer data-popup-open:bg-muted" />
        }
      >
        <MoreHorizontal aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {actions.map(({ label, icon: Icon, destructive, onSelect }) => (
          <DropdownMenuItem
            key={label}
            variant={destructive ? "destructive" : "default"}
            className="cursor-pointer pointer-coarse:min-h-11"
            onClick={() => trigger.current && onSelect(trigger.current)}
          >
            <Icon aria-hidden="true" />
            {label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLinkItem render={<Link to={historyHref} />} className="cursor-pointer pointer-coarse:min-h-11">
          <History aria-hidden="true" />
          Change history
        </DropdownMenuLinkItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
