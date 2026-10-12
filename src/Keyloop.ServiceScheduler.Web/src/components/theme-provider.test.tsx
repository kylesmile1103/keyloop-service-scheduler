import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ModeToggle } from "@/components/mode-toggle"
import { ThemeProvider } from "@/components/theme-provider"

/** A controllable `prefers-color-scheme: dark` media query. */
function systemTheme(prefersDark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  let dark = prefersDark
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        get matches() {
          return query.includes("prefers-color-scheme: dark") ? dark : false
        },
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
          listeners.delete(listener),
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList
  )
  return {
    change(prefersDarkNow: boolean) {
      dark = prefersDarkNow
      act(() => listeners.forEach((listener) => listener({ matches: prefersDarkNow } as MediaQueryListEvent)))
    },
  }
}

const html = document.documentElement

describe("theme", () => {
  it("renders and switches theme when localStorage reads and writes are blocked", () => {
    systemTheme(true)
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError")
    })
    render(<ThemeProvider><ModeToggle /></ThemeProvider>)
    expect(html).toHaveClass("dark")
    fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }))
    expect(html).toHaveClass("light")
    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeInTheDocument()
  })

  it("follows the operating system while set to system", () => {
    const os = systemTheme(false)
    render(<ThemeProvider defaultTheme="system" storageKey="theme-test">{null}</ThemeProvider>)
    expect(html).toHaveClass("light")

    os.change(true)

    expect(html).toHaveClass("dark")
    expect(html).not.toHaveClass("light")
  })

  it("switches a dark operating-system theme to light on the first click", () => {
    systemTheme(true)
    render(
      <ThemeProvider defaultTheme="system" storageKey="theme-test">
        <ModeToggle />
      </ThemeProvider>
    )
    expect(html).toHaveClass("dark")

    fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }))

    expect(html).toHaveClass("light")
    expect(localStorage.getItem("theme-test")).toBe("light")
    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeInTheDocument()
  })
})
