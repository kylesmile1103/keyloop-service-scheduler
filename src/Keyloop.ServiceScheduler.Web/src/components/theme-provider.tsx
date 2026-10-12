// Adopted from shadcn-dashboard-landing-template (vite-version) `src/components/theme-provider.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
"use client"

import * as React from "react"
import { ThemeProviderContext, type Theme } from "@/contexts/theme-context"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

const DARK_QUERY = "(prefers-color-scheme: dark)"

function subscribeToSystemTheme(onChange: () => void) {
  const query = window.matchMedia(DARK_QUERY)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

function readTheme(storageKey: string, fallback: Theme): Theme {
  try {
    const stored = localStorage.getItem(storageKey)
    return stored === "dark" || stored === "light" || stored === "system" ? stored : fallback
  } catch {
    return fallback
  }
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "keyloop-scheduler-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = React.useState<Theme>(() => readTheme(storageKey, defaultTheme))
  const prefersDark = React.useSyncExternalStore(
    subscribeToSystemTheme,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false
  )
  const resolvedTheme = theme === "system" ? (prefersDark ? "dark" : "light") : theme

  React.useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove("light", "dark")
    root.classList.add(resolvedTheme)
  }, [resolvedTheme])

  const value = React.useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme: (next: Theme) => {
        try {
          localStorage.setItem(storageKey, next)
        } catch {
          // Storage may be blocked; the current page still supports theme changes.
        }
        setTheme(next)
      },
    }),
    [theme, resolvedTheme, storageKey]
  )

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}
