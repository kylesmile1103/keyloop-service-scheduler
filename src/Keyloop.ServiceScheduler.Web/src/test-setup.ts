import "@testing-library/jest-dom/vitest"

import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

import { matchesWidth } from "@/test/media-query"

afterEach(() => {
  cleanup()
  localStorage.clear()
  document.documentElement.className = ""
})

// jsdom has no matchMedia (used by the sidebar's breakpoint hooks and the theme provider): report a wide (1440 px),
// light-scheme desktop viewport, answering width queries against that width and everything else with "no".
// Tests that need another answer spy on window.matchMedia (see viewportOf in src/test/render-board.tsx).
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: matchesWidth(query, 1440),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })
}

// jsdom has no PointerEvent. Base UI creates one when an option is chosen from the keyboard, and reads `pointerType` from
// pointer events; a MouseEvent carrying the pointer fields is enough for both.
if (!window.PointerEvent) {
  class PointerEvent extends MouseEvent {
    readonly pointerId: number
    readonly pointerType: string
    readonly isPrimary: boolean

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
      this.pointerType = init.pointerType ?? ""
      this.isPrimary = init.isPrimary ?? false
    }
  }
  window.PointerEvent = PointerEvent as unknown as typeof window.PointerEvent
}
