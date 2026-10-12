import { Search } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
  className?: string
}

/** The list's search box: customer, registration or VIN (the faceted filters cover the rest). */
export function SearchField({ value, onChange, className }: SearchFieldProps) {
  return (
    <div className={cn("relative", className)}>
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label="Search appointments"
        placeholder="Customer, registration or VIN"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="pl-9"
      />
    </div>
  )
}
