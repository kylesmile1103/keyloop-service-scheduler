import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { useUnsavedWork } from "@/hooks/use-unsaved-work"
import { hasUnsavedWork, holdUnsavedWork } from "@/lib/unsaved-work"

// What a session renewal's navigation would lose (Task 36): views hold a claim while they have work on screen.

describe("unsaved work", () => {
  it("is held while any claim is, and a release twice does not drop another view's claim", () => {
    expect(hasUnsavedWork()).toBe(false)
    const first = holdUnsavedWork()
    const second = holdUnsavedWork()
    first()
    first()
    expect(hasUnsavedWork()).toBe(true)
    second()
    expect(hasUnsavedWork()).toBe(false)
  })

  it("is held by a view while it says so, and let go when it stops or unmounts", () => {
    const view = renderHook(({ active }) => useUnsavedWork(active), { initialProps: { active: false } })
    expect(hasUnsavedWork()).toBe(false)
    view.rerender({ active: true })
    expect(hasUnsavedWork()).toBe(true)
    view.rerender({ active: false })
    expect(hasUnsavedWork()).toBe(false)
    view.rerender({ active: true })
    view.unmount()
    expect(hasUnsavedWork()).toBe(false)
  })
})
