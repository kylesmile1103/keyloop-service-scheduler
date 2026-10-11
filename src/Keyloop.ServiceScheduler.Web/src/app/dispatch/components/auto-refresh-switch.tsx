import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

/**
 * Reads the board again every 5 seconds while on (TanStack `refetchInterval`); the board also refreshes on window focus.
 * The label is the switch's target, 44 px tall on a touch screen.
 */
export function AutoRefreshSwitch({
  checked,
  onCheckedChange,
  className,
}: {
  checked: boolean
  onCheckedChange: (on: boolean) => void
  className?: string
}) {
  return (
    <Label className={cn("cursor-pointer gap-2.5 font-normal whitespace-nowrap pointer-coarse:min-h-11", className)}>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
      Auto-refresh
    </Label>
  )
}
