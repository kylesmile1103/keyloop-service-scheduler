// Adopted from shadcn-dashboard-landing-template (vite-version) `src/components/mode-toggle.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
"use client"

import { Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useTheme } from "@/hooks/use-theme"
import { useCircularTransition } from "@/hooks/use-circular-transition"
import { cn } from "@/lib/utils"
import "./circular-transition.css"

interface ModeToggleProps {
  variant?: "outline" | "ghost" | "default"
  className?: string
}

export function ModeToggle({ variant = "outline", className }: ModeToggleProps) {
  const { resolvedTheme } = useTheme()
  const { toggleTheme } = useCircularTransition()
  const isDarkMode = resolvedTheme === "dark"

  return (
    <Button
      variant={variant}
      size="icon"
      onClick={toggleTheme}
      className={cn("cursor-pointer mode-toggle-button relative overflow-hidden", className)}
    >
      {/* Show the icon for the mode you can switch TO */}
      {isDarkMode ? (
        <Sun className="size-5 transition-transform duration-300 rotate-0 scale-100" />
      ) : (
        <Moon className="size-5 transition-transform duration-300 rotate-0 scale-100" />
      )}
      <span className="sr-only">
        Switch to {isDarkMode ? "light" : "dark"} mode
      </span>
    </Button>
  )
}
