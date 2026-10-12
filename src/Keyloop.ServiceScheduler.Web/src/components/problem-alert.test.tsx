import { fireEvent, render, screen } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import { ProblemAlert } from "@/components/problem-alert"
import { expectAvailable, expectUnavailableButFocusable } from "@/test/focus"

// The shared failure alert's retry: it must not drop keyboard focus while it waits (UI_DESIGN 11.16).

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

  it("reads a second failure out as new content, even in the same words, and keeps focus on Try again", () => {
    const onRetry = vi.fn()
    const unreachable = "The server could not be reached. Check the connection, then try again."
    const { rerender } = render(<ProblemAlert title="Couldn’t load the services" error={failure} onRetry={onRetry} />)
    const retry = screen.getByRole("button", { name: "Try again" })
    const explanation = screen.getByText(unreachable)
    retry.focus()

    rerender(<ProblemAlert title="Couldn’t load the services" error={failure} onRetry={onRetry} retrying />)
    expect(explanation).toBeInTheDocument()

    // A screen reader reads out what an alert gains, not text that stays: the second failure's words are a new node.
    rerender(<ProblemAlert title="Couldn’t load the services" error={new TypeError("Failed to fetch")} onRetry={onRetry} />)
    expect(explanation).not.toBeInTheDocument()
    expect(screen.getByText(unreachable)).toBeInTheDocument()
    expect(retry).toHaveFocus()
  })

  it("keeps Try again focusable while a rate limit's wait runs", () => {
    render(<ProblemAlert title="Couldn’t book the appointment" error={failure} onRetry={() => {}} retryDisabled />)

    expectUnavailableButFocusable(screen.getByRole("button", { name: "Try again" }))
  })

  it("can take focus itself through focusRef, out of the tab order, and only then", () => {
    const alertRef = createRef<HTMLDivElement>()
    const { rerender } = render(<ProblemAlert title="Slot just taken - pick another time" error={failure} tone="warning" />)
    expect(screen.getByRole("alert")).not.toHaveAttribute("tabindex")

    rerender(<ProblemAlert title="Slot just taken - pick another time" error={failure} tone="warning" focusRef={alertRef} />)
    const alert = screen.getByRole("alert")
    expect(alertRef.current).toBe(alert)
    expect(alert).toHaveAttribute("tabindex", "-1")
    alertRef.current!.focus()
    expect(alert).toHaveFocus()
  })
})
