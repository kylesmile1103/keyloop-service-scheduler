"use client"

import { Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useTheme } from "@/hooks/use-theme"
import { useCircularTransition } from "@/hooks/use-circular-transition"
import "./circular-transition.css"

interface ModeToggleProps {
  variant?: "outline" | "ghost" | "default"
}

export function ModeToggle({ variant = "outline" }: ModeToggleProps) {
  const { resolvedTheme } = useTheme()
  const { toggleTheme } = useCircularTransition()
  const isDarkMode = resolvedTheme === "dark"

  return (
    <Button
      variant={variant}
      size="icon"
      onClick={toggleTheme}
      className="cursor-pointer mode-toggle-button relative overflow-hidden"
    >
      {/* Show the icon for the mode you can switch TO */}
      {isDarkMode ? (
        <Sun className="size-[1.2rem] transition-transform duration-300 rotate-0 scale-100" />
      ) : (
        <Moon className="size-[1.2rem] transition-transform duration-300 rotate-0 scale-100" />
      )}
      <span className="sr-only">
        Switch to {isDarkMode ? "light" : "dark"} mode
      </span>
    </Button>
  )
}
