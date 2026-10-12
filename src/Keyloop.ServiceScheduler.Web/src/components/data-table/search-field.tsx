import { Search } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/** What a list's search box says: its accessible name and the fields it searches, as the placeholder. */
export interface SearchCopy {
  /** "Search appointments". */
  label: string
  /** "Customer, registration or VIN". */
  placeholder: string
}

interface SearchFieldProps extends SearchCopy {
  value: string
  onChange: (value: string) => void
  className?: string
}

/** A list's search box (the faceted filters cover the rest). */
export function SearchField({ value, onChange, label, placeholder, className }: SearchFieldProps) {
  return (
    <div className={cn("relative", className)}>
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
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
