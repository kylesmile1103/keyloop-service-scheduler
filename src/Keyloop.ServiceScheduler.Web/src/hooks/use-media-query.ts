// Adopted from shadcn-dashboard-landing-template (vite-version) `src/hooks/use-mobile.ts`,
// Copyright (c) 2025 ShadcnStore, MIT License.
import * as React from "react"

/** Subscribes to a CSS media query and returns whether it currently matches. */
export function useMediaQuery(query: string) {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    [query]
  )
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  )
}
