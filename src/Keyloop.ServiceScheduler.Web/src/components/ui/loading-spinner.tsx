// Adopted from shadcn-dashboard-landing-template (vite-version) `src/components/ui/loading-spinner.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License, and Copyright (c) 2023 shadcn, MIT License.
"use client"

import { cn } from "cn"

interface LoadingSpinnerProps {
  className?: string
  size?: "sm" | "md" | "lg"
}

export function LoadingSpinner({
  className,
  size = "md",
}: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: "h-4 w-4",
    md: "h-8 w-8",
    lg: "h-12 w-12",
  }

  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex items-center justify-center min-h-[200px]"
    >
      <div
        className={cn(
          "animate-spin rounded-full border-b-2 border-primary",
          sizeClasses[size],
          className
        )}
      />
    </div>
  )
}
