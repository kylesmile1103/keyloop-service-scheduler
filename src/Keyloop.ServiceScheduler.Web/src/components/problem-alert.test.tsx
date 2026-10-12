import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ProblemAlert } from "@/components/problem-alert"
import { expectAvailable, expectUnavailableButFocusable } from "@/test/focus"

// The shared failure alert's retry: it must not drop keyboard focus while it waits (DESIGN_SYSTEM 11.16).

const failure = new TypeError("Failed to fetch")

describe("problem alert", () => {
  it("keeps keyboard focus on Try again while the retry is out, and ignores presses meanwhile", () => {
    const onRetry = vi.fn()
    const { rerender } = render(<ProblemAlert title="Couldn’t load the services" error={failure} onRetry={onRetry} />)
    const retry = screen.getByRole("button", { name: "Try again" })
    retry.focus()
    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)

    rerender(<ProblemAlert title="Couldn’t load the services" error={failure} onRetry={onRetry} retrying />)
    expect(retry).toHaveFocus()
    expectUnavailableButFocusable(retry)
    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)

    // The retry failed too: the same button, still focused, can try again.
    rerender(<ProblemAlert title="Couldn’t load the services" error={failure} onRetry={onRetry} />)
    expect(retry).toHaveFocus()
    expectAvailable(retry)
  })

  it("keeps Try again focusable while a rate limit's wait runs", () => {
    render(<ProblemAlert title="Couldn’t book the appointment" error={failure} onRetry={() => {}} retryDisabled />)

    expectUnavailableButFocusable(screen.getByRole("button", { name: "Try again" }))
  })
})
