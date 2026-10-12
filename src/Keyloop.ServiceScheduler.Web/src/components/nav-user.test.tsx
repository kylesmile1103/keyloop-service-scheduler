import { fireEvent, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import type { CurrentUserResponse } from "@/api/types.gen"
import { mockBoardApi } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { admin, anonymous, noRole, serviceAdvisor, unnamedAdvisor, viewer } from "@/test/identities"
import { jsonResponse } from "@/test/mock-api"
import { phoneViewport, renderBoard } from "@/test/render-board"

// The sidebar footer's user row and menu (Task 27b), from GET /me.

const identity = vi.hoisted(() => ({ source: "access" as "access" | "configuration" }))
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  identitySource: () => identity.source,
}))
afterEach(() => {
  identity.source = "access"
})

beforeAll(async () => {
  // The board is where most of these render: loaded once here, so a test never waits on its lazy chunk under load.
  await Promise.all([import("@/app/settings/appearance/page"), import("@/app/dispatch/page")])
})

const board = `/dispatch?dealership=${reading.id}&date=2026-10-14`

/** The user row, by what it says, and the menu it opens. */
async function openUserMenu(name: RegExp) {
  fireEvent.click(await screen.findByRole("button", { name }))
  return screen.findByRole("menu")
}

describe("the user menu", () => {
  it("shows a visitor who is not signed in, with Sign in back to the same board, dealership and day", async () => {
    mockBoardApi({ me: () => anonymous })
    renderBoard(board)

    const menu = await openUserMenu(/Not signed in/)
    expect(within(menu).getByText("Sign in with a workshop account to book, cancel and see customer details.")).toBeInTheDocument()
    expect(within(menu).getByRole("menuitem", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/auth/login?returnTo=${encodeURIComponent(`/dispatch?dealership=${reading.id}&date=2026-10-14`)}`
    )
    expect(within(menu).getByRole("menuitem", { name: "Account" })).toHaveAttribute("href", "/settings/account")
    expect(within(menu).queryByRole("menuitem", { name: "Sign out" })).not.toBeInTheDocument()
    // The theme stays in the menu, where a phone finds it.
    expect(within(menu).getByRole("menuitemradio", { name: "Dark" })).toBeInTheDocument()
  })

  it.each<[string, CurrentUserResponse, string, string[]]>([
    ["a Viewer", viewer, "Viewer", ["Viewer"]],
    ["a Service advisor", serviceAdvisor, "Service advisor", ["Service advisor"]],
    ["an Admin", admin, "Admin", ["Admin"]],
    ["several roles", { ...admin, roles: ["Admin", "ServiceAdvisor"] }, "Admin, Service advisor", ["Admin", "Service advisor"]],
  ])("shows %s with the name, roles, Account and Sign out", async (_, me, roleLine, badges) => {
    mockBoardApi({ me: () => me })
    renderBoard(board)

    const row = await screen.findByRole("button", { name: new RegExp(me.displayName!) })
    expect(within(row).getByText(roleLine)).toBeInTheDocument()

    const menu = await openUserMenu(new RegExp(me.displayName!))
    const account = within(menu).getByRole("group", { name: new RegExp(me.displayName!) })
    expect(within(account).getByText(me.email!)).toBeInTheDocument()
    for (const badge of badges) expect(within(account).getAllByText(badge).length).toBeGreaterThan(0)
    expect(within(menu).getByRole("menuitem", { name: "Account" })).toHaveAttribute("href", "/settings/account")
    // Sign out is the hostname's Access logout, a plain navigation.
    expect(within(menu).getByRole("menuitem", { name: "Sign out" })).toHaveAttribute("href", "/cdn-cgi/access/logout")
    expect(within(menu).queryByRole("menuitem", { name: "Sign in" })).not.toBeInTheDocument()
  })

  it("shows an account without a role, and who assigns roles", async () => {
    mockBoardApi({ me: () => noRole })
    renderBoard(board)

    const row = await screen.findByRole("button", { name: /Robin Visitor/ })
    expect(within(row).getByText("No role yet")).toBeInTheDocument()
    const menu = await openUserMenu(/Robin Visitor/)
    expect(within(menu).getByText("No role")).toBeInTheDocument()
    expect(within(menu).getByText("No workshop role yet: the workshop administrator assigns roles.")).toBeInTheDocument()
    expect(within(menu).getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument()
  })

  it("names an account by its email when the token carries no name", async () => {
    mockBoardApi({ me: () => unnamedAdvisor })
    renderBoard(board)

    expect(await screen.findByRole("button", { name: /advisor@keyloop\.test/ })).toBeInTheDocument()
  })

  it("says it is checking while /me is read, never a made-up user", async () => {
    mockBoardApi({ me: () => new Promise<Response>(() => {}) })
    renderBoard(board)

    const row = await screen.findByRole("button", { name: /Checking sign-in/ })
    expect(row).toHaveAttribute("aria-busy", "true")
  })

  it("says when it could not check, treats the user as signed out and tries again", async () => {
    let me: Response | CurrentUserResponse = new Response("", { status: 502, statusText: "Bad Gateway" })
    mockBoardApi({ me: () => me })
    renderBoard(board)

    const menu = await openUserMenu(/Sign-in not checked/)
    expect(within(menu).getByText("Couldn’t check who is signed in, so the app treats you as signed out.")).toBeInTheDocument()
    expect(within(menu).getByRole("menuitem", { name: "Sign in" })).toBeInTheDocument()

    me = jsonResponse(serviceAdvisor)
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Try again" }))
    expect(await screen.findByRole("button", { name: /Sam Advisor/ })).toBeInTheDocument()
  })

  it("stays reachable on a phone, in the sidebar sheet", async () => {
    phoneViewport()
    mockBoardApi({ me: () => anonymous })
    renderBoard(board)

    fireEvent.click(await screen.findByRole("button", { name: "Toggle Sidebar" }))
    const sidebar = await screen.findByRole("dialog", { name: "Sidebar" })
    fireEvent.click(await within(sidebar).findByRole("button", { name: /Not signed in/ }))
    expect(await screen.findByRole("menuitem", { name: "Sign in" })).toBeInTheDocument()
  })

  describe("on the development server, whose identity is configuration", () => {
    it("offers no Sign out it could not honour, and says why", async () => {
      identity.source = "configuration"
      mockBoardApi({ me: () => admin })
      renderBoard(board)

      const menu = await openUserMenu(/Development user/)
      expect(within(menu).getByText(/Signed in by this development server's configuration, so there is no sign-out here\./)).toBeInTheDocument()
      expect(within(menu).queryByRole("menuitem", { name: "Sign out" })).not.toBeInTheDocument()
      expect(within(menu).getByRole("menuitem", { name: "Account" })).toBeInTheDocument()
    })

    it("leads a visitor to how to sign in, not to a login page that is not there", async () => {
      identity.source = "configuration"
      mockBoardApi({ me: () => anonymous })
      renderBoard(board)

      const menu = await openUserMenu(/Not signed in/)
      expect(within(menu).getByRole("menuitem", { name: "How to sign in" })).toHaveAttribute("href", "/settings/account")
      expect(within(menu).queryByRole("menuitem", { name: "Sign in" })).not.toBeInTheDocument()
    })
  })
})
