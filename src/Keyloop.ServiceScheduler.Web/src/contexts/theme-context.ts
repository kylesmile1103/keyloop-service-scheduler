import * as React from "react"

export type Theme = "dark" | "light" | "system"

export type ThemeProviderState = {
  /** The user's choice. */
  theme: Theme
  /** What is on screen: the choice, or the operating system's preference while the choice is "system". */
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
