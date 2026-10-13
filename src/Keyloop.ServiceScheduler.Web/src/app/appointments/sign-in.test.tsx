import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { NO_ROLE_REASON, READ_ONLY_REASON } from "@/lib/session"
import { mockBoardApi } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { anonymous, noRole, viewer } from "@/test/identities"
import { renderBoard } from "@/test/render-board"

beforeAll(async () => {
  await import("@/app/appointments/page")
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

const readingList = `/appointments?dealership=${reading.id}`
const writes = (requests: readonly Request[]) => requests.filter((request) => request.method !== "GET")

describe("a row's Cancel", () => {
  it.each([
    ["a Viewer", viewer, READ_ONLY_REASON],
    ["an account without a role", noRole, NO_ROLE_REASON],
  ])("is unavailable to %s, with the reason under it and read with it", async (_, me, reason) => {
    const { requests } = mockBoardApi({ me: () => me })
    renderBoard(readingList)

    fireEvent.click(await screen.findByRole("button", { name: "Actions for Interim Service at 08:00, Sophie Turner" }))
    const cancel = await screen.findByRole("menuitem", { name: "Cancel appointment" })
    expect(cancel).toHaveAttribute("aria-disabled", "true")
    const note = document.getElementById(cancel.getAttribute("aria-describedby")!)
    expect(note).toHaveTextContent(reason)
    expect(note).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "View details" })).not.toHaveAttribute("aria-disabled")

    fireEvent.click(cancel)
    expect(screen.queryByRole("dialog", { name: "Interim Service" })).not.toBeInTheDocument()
    expect(writes(requests)).toHaveLength(0)
  })

  it("opens the sheet's sign-in panel for a visitor who is not signed in, and sends nothing", async () => {
    const { requests } = mockBoardApi({ me: () => anonymous })
    renderBoard(readingList)

    fireEvent.click(await screen.findByRole("button", { name: "Actions for Interim Service at 08:00, Sophie Turner" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Cancel appointment" }))

    const sheet = await screen.findByRole("dialog", { name: "Interim Service" })
    const panel = within(sheet).getByRole("region", { name: "Sign in to see the whole booking" })
    expect(within(panel).getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/auth/login?returnTo=${encodeURIComponent(readingList)}`
    )
    await waitFor(() => expect(within(sheet).getByRole("heading", { name: "Interim Service" })).toHaveFocus())
    expect(within(sheet).queryByRole("textbox", { name: "Reason" })).not.toBeInTheDocument()
    expect(requests.filter((request) => new URL(request.url).pathname.startsWith("/api/v1/appointments/"))).toHaveLength(0)
    expect(writes(requests)).toHaveLength(0)
  })
})
