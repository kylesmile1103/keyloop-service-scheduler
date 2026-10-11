import "@testing-library/jest-dom/vitest"

import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

afterEach(() => {
  cleanup()
  localStorage.clear()
  document.documentElement.className = ""
})

// jsdom has no matchMedia (used by the sidebar's mobile hook and the theme provider): report a wide, light-scheme
// desktop viewport. Tests that need another answer spy on window.matchMedia.
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })
}
