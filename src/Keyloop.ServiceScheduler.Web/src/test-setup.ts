import "@testing-library/jest-dom/vitest"

import { cleanup, configure } from "@testing-library/react"
import { afterEach } from "vitest"

import { matchesWidth } from "@/test/media-query"

// Async utilities (waitFor, findBy*) poll every 50 ms and return as soon as their condition holds, so this budget costs
// passing tests nothing; it only bounds how long a genuinely failing wait takes to report. 3 s was not enough: CI run
// 38559039472 (2026-10-14) ran the suite at half its usual speed and single successful waits took up to 3.4 s, so two
// route-change tests timed out. 10 s keeps 3x headroom over that while staying inside Vitest's 15 s per-test budget.
configure({ asyncUtilTimeout: 10_000 })

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
