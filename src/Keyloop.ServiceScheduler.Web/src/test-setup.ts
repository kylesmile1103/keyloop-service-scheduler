import "@testing-library/jest-dom/vitest"

import { cleanup, configure } from "@testing-library/react"
import { afterEach } from "vitest"

import { matchesWidth } from "@/test/media-query"

// Raise async utility timeout above 1s so lazy-route compilation and dialog renders do not flake under parallel load.
configure({ asyncUtilTimeout: 3000 })

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
  document.documentElement.className = ""
})

// Polyfill matchMedia for jsdom with a 1440px light-scheme desktop default.
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

// Polyfill PointerEvent for Base UI keyboard/pointer interactions in jsdom.
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
