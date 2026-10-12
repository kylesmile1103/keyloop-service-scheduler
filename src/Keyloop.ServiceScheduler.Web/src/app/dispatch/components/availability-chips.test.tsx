import { QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { createQueryClient } from "@/lib/query-client"
import { mockBoardApi } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { interimAvailability, interimServiceType } from "@/test/schedules"

import { AvailabilityChips } from "./availability-chips"

// The free start times on their own: where a focus request puts keyboard focus once the chips are on screen.

function renderChips(value: string) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <span id="start-label">Start time</span>
      <AvailabilityChips
        dealershipId={reading.id}
        serviceType={interimServiceType}
        date={interimAvailability.date}
        value={value}
        onValueChange={() => {}}
        labelledBy="start-label"
        focusRequest={1}
      />
    </QueryClientProvider>
  )
}

describe("focus requests on the free start times", () => {
  it("moves focus to the chosen start, not to the first one on the page", async () => {
    mockBoardApi()
    const [, later] = interimAvailability.slots
    renderChips(later.startUtc)

    const chosen = await screen.findByRole("radio", { name: /^10:30/ })
    expect(chosen).toHaveAttribute("aria-checked", "true")
    await waitFor(() => expect(chosen).toHaveFocus())
    expect(screen.getByRole("radio", { name: /^10:15/ })).not.toHaveFocus()
  })

  it("moves focus to the first start when none is chosen", async () => {
    mockBoardApi()
    renderChips("")

    const first = await screen.findByRole("radio", { name: /^10:15/ })
    await waitFor(() => expect(first).toHaveFocus())
  })
})
