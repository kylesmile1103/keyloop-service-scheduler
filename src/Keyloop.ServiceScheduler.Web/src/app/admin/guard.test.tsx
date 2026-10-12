import { fireEvent, screen } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { CurrentUserResponse } from "@/api/types.gen"
import { adminServer } from "@/test/admin-api"
import { mockBoardApi, requestsTo } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { admin, anonymous, noRole, serviceAdvisor, viewer } from "@/test/identities"
import { jsonResponse } from "@/test/mock-api"
import { renderBoard } from "@/test/render-board"

// The Resources area needs a signed-in user with a role (Task 27b, ADR-027): the 401 page in place for a visitor who is
// not signed in, the 403 page for an account without a role, the lists for Viewer, Service advisor and Admin (an Admin's
// from the Admin reads, editable, Task 30b).

beforeAll(async () => {
  await Promise.all([import("@/app/admin/layout"), import("@/app/admin/technicians/page"), import("@/app/admin/bays/page")])
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

const technicians = `/resources/technicians?dealership=${reading.id}`
const heading = (name: string) => screen.findByRole("heading", { level: 1, name })

describe("the Resources area's sign-in guard", () => {
  it("shows a visitor who is not signed in the 401 page in place, signing in back to the same list and dealership", async () => {
    const { requests } = mockBoardApi({ me: () => anonymous })
    const { router } = renderBoard(technicians)

    expect(await heading("Sign in to continue")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/auth/login?returnTo=${encodeURIComponent(technicians)}`
    )
    // In place: the address stays, so signing in comes back to it; nothing of the area is read.
    expect(router.state.location.pathname).toBe("/resources/technicians")
    expect(screen.queryByRole("table", { name: "Technicians" })).not.toBeInTheDocument()
    expect(requestsTo(requests, "/schedule")).toHaveLength(0)
  })

  it("shows an account without a role the 403 page, which says the workshop administrator assigns roles", async () => {
    mockBoardApi({ me: () => noRole })
    renderBoard(`/resources/bays?dealership=${reading.id}`)

    expect(await heading("No access to this page")).toBeInTheDocument()
    expect(screen.getByText(/assigned by the workshop administrator/)).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument()
    expect(screen.queryByRole("table", { name: "Bays" })).not.toBeInTheDocument()
  })

  it.each<[string, CurrentUserResponse]>([
    ["a Viewer", viewer],
    ["a Service advisor", serviceAdvisor],
    ["an Admin", admin],
  ])("lets %s read the lists", async (_, me) => {
    mockBoardApi({ me: () => me, admin: adminServer({ me: () => me }) })
    renderBoard(technicians)

    expect(await screen.findByRole("table", { name: "Technicians" }, { timeout: 5000 })).toBeInTheDocument()
  })

  it("says it is checking until /me answers, and opens nothing before", async () => {
    let answer: (response: Response) => void = () => {}
    mockBoardApi({ me: () => new Promise<Response>((resolve) => (answer = resolve)) })
    renderBoard(technicians)

    expect(await screen.findByText("Checking who is signed in…")).toBeInTheDocument()
    expect(screen.queryByRole("table", { name: "Technicians" })).not.toBeInTheDocument()

    answer(jsonResponse(viewer))
    expect(await screen.findByRole("table", { name: "Technicians" }, { timeout: 5000 })).toBeInTheDocument()
  })

  it("says when it could not check who is signed in, and tries again", async () => {
    let me: Response | CurrentUserResponse = new Response("", { status: 502, statusText: "Bad Gateway" })
    mockBoardApi({ me: () => me })
    renderBoard(technicians)

    expect(await screen.findByRole("heading", { name: "Couldn’t check who is signed in" })).toBeInTheDocument()
    me = viewer
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByRole("table", { name: "Technicians" }, { timeout: 5000 })).toBeInTheDocument()
  })
})
