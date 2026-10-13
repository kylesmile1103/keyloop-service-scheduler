// Adopted from shadcn-dashboard-landing-template (vite-version) `src/components/ui/skeleton.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License, and Copyright (c) 2023 shadcn, MIT License.
import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
