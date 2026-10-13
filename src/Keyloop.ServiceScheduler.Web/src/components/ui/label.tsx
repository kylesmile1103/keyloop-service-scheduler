// Adopted from shadcn-dashboard-landing-template (vite-version) `src/components/ui/label.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License, and Copyright (c) 2023 shadcn, MIT License.
import * as React from "react"
import { cn } from "cn"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
