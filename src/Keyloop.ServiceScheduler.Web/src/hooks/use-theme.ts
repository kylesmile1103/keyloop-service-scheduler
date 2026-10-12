// Adopted from shadcn-dashboard-landing-template (vite-version) `src/hooks/use-theme.ts`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import * as React from "react"
import { ThemeProviderContext } from "@/contexts/theme-context"

export const useTheme = () => {
  const context = React.useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider")

  return context
}
