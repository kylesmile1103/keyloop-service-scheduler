// Adopted from shadcn-dashboard-landing-template (vite-version) `src/contexts/theme-context.ts`,
// Copyright (c) 2025 ShadcnStore, MIT License.
import * as React from "react"

export type Theme = "dark" | "light" | "system"

export type ThemeProviderState = {
  theme: Theme
  /** Active theme on screen (`theme` or the OS preference when `theme` is `"system"`). */
  resolvedTheme: "dark" | "light"
  setTheme: (theme: Theme) => void
}

const initialState: ThemeProviderState = {
  theme: "system",
  resolvedTheme: "light",
  setTheme: () => null,
}

export const ThemeProviderContext =
  React.createContext<ThemeProviderState>(initialState)
