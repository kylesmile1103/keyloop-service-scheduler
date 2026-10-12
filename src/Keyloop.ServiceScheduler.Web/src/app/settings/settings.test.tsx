import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { createMemoryRouter } from "react-router-dom"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import App from "@/App"
import { appRoutes } from "@/config/routes"
import { createQueryClient } from "@/lib/query-client"
import { mockBoardApi } from "@/test/board-api"
import { admin, anonymous, noRole, serviceAdvisor, unnamedAdvisor, viewer } from "@/test/identities"

// The Settings pages (Task 29): Appearance (the theme) and Account, which shows `GET /me` (Task 27b).

// Where the identity comes from: Cloudflare Access unless a test says the development server's configuration.
const identity = vi.hoisted(() => ({ source: "access" as "access" | "configuration" }))
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  identitySource: () => identity.source,
}))
afterEach(() => {
  identity.source = "access"
})

beforeAll(async () => {
  await Promise.all([import("@/app/settings/appearance/page"), import("@/app/settings/account/page")])
})

beforeEach(() => {
  mockBoardApi()
})

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const queryClient = createQueryClient()
  // Failures show at once; the production retry policy is covered by lib/query-client.test.ts.
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  render(<App router={router} queryClient={queryClient} />)
  return router
}

const themeChoice = (name: string) => within(screen.getByRole("radiogroup", { name: "Theme" })).getByRole("radio", { name })

describe("appearance settings", () => {
  it("offers light, dark and the device's own setting, with the current choice selected", async () => {
    renderAt("/settings/appearance")

    expect(await screen.findByRole("heading", { level: 1, name: "Appearance" })).toBeInTheDocument()
    const group = screen.getByRole("radiogroup", { name: "Theme" })
    expect(within(group).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label") ?? radio.textContent)).toHaveLength(3)
    expect(themeChoice("Light")).not.toBeChecked()
    expect(themeChoice("Dark")).not.toBeChecked()
    // The app's default: follow the device.
    expect(themeChoice("Match system")).toBeChecked()
    expect(document.title).toBe("Appearance – Keyloop Service Scheduler")
  })

  it("applies a choice at once and keeps it on this device", async () => {
    renderAt("/settings/appearance")
    await screen.findByRole("heading", { level: 1, name: "Appearance" })

    fireEvent.click(themeChoice("Dark"))
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"))
    expect(themeChoice("Dark")).toBeChecked()
    expect(localStorage.getItem("keyloop-scheduler-theme")).toBe("dark")
    // The header's toggle and the page say the same.
    expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeInTheDocument()

    fireEvent.click(themeChoice("Light"))
    await waitFor(() => expect(document.documentElement).toHaveClass("light"))
    expect(localStorage.getItem("keyloop-scheduler-theme")).toBe("light")
  })

  it("follows the header's toggle", async () => {
    renderAt("/settings/appearance")
    await screen.findByRole("heading", { level: 1, name: "Appearance" })

    fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }))
    await waitFor(() => expect(themeChoice("Dark")).toBeChecked())
  })

  it("is the Settings section's first page", async () => {
    const router = renderAt("/settings")

    expect(await screen.findByRole("heading", { level: 1, name: "Appearance" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/settings/appearance")
  })
})

describe("account settings", () => {
  const facts = () => within(screen.getByRole("list", { name: "What you can do" })).getAllByRole("listitem").map((item) => item.textContent)

  it("shows a visitor who is not signed in what they can do, and Sign in back to this page", async () => {
    mockBoardApi({ me: () => anonymous })
    renderAt("/settings/account")

    expect(await screen.findByRole("heading", { level: 2, name: "You’re not signed in" })).toBeInTheDocument()
    expect(facts()).toEqual([
      "Yes: View the board and the appointments list, with customer details masked",
      "No: See customer names, contact details and vehicles",
      "No: Book, cancel and ask for service suggestions",
      "No: Open Resources: technicians, bays and services",
    ])
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login?returnTo=%2Fsettings%2Faccount")
    expect(screen.queryByRole("link", { name: "Sign out" })).not.toBeInTheDocument()
    // Nothing to edit: the account lives with Cloudflare Access, and no password is ever asked for.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(document.querySelector("input[type=password]")).toBeNull()
    expect(document.title).toBe("Account – Keyloop Service Scheduler")
  })

  it.each([
    ["a Viewer", viewer, "Vera Viewer", ["Viewer"], [true, true, false, true]],
    ["a Service advisor", serviceAdvisor, "Sam Advisor", ["Service advisor"], [true, true, true, true]],
    ["an Admin", admin, "Development user", ["Admin"], [true, true, true, true]],
    ["an account without a role", noRole, "Robin Visitor", ["No role"], [true, false, false, false]],
  ])("shows %s, their roles, what those allow and Sign out", async (_, me, name, badges, allowed) => {
    mockBoardApi({ me: () => me })
    renderAt("/settings/account")

    const card = await screen.findByRole("region", { name })
    expect(within(card).getByText(me.email!)).toBeInTheDocument()
    for (const badge of badges) expect(within(card).getByText(badge)).toBeInTheDocument()
    expect(facts().map((fact) => fact?.startsWith("Yes"))).toEqual(allowed)
    const signOut = within(card).getByRole("link", { name: "Sign out" })
    expect(signOut).toHaveAttribute("href", "/cdn-cgi/access/logout")
    // An outline button: its border colour replaces the base's transparent one (a link styled by buttonVariants alone kept both).
    expect(signOut).toHaveClass("border-input")
    expect(signOut).not.toHaveClass("border-transparent")
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument()
  })

  it("tells an account without a role that the workshop administrator assigns roles", async () => {
    mockBoardApi({ me: () => noRole })
    renderAt("/settings/account")

    expect(await screen.findByText(/Your account has no workshop role yet\. Roles \(Admin, Service advisor, Viewer\) are assigned by the workshop/)).toBeInTheDocument()
  })

  it("names an account by its email when the token carries no name", async () => {
    mockBoardApi({ me: () => unnamedAdvisor })
    renderAt("/settings/account")

    expect(await screen.findByRole("heading", { level: 2, name: "advisor@keyloop.test" })).toBeInTheDocument()
  })

  it("says when it could not check who is signed in, and tries again", async () => {
    let me: Response | typeof viewer = new Response("", { status: 502, statusText: "Bad Gateway" })
    mockBoardApi({ me: () => me })
    renderAt("/settings/account")

    expect(await screen.findByText("Couldn’t check who is signed in")).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 2, name: "You’re not signed in" })).toBeInTheDocument()

    me = viewer
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByRole("region", { name: "Vera Viewer" })).toBeInTheDocument()
  })

  it("on the development server, says the identity is configuration and how to try each role", async () => {
    identity.source = "configuration"
    mockBoardApi({ me: () => admin })
    renderAt("/settings/account")

    const card = await screen.findByRole("region", { name: "How to sign in on this development server" })
    const settings = within(within(card).getByRole("list", { name: "Development identities" })).getAllByRole("listitem")
    expect(settings.map((item) => item.querySelector("code")?.textContent)).toEqual([
      "Auth__Development__Roles__0=Admin",
      "Auth__Development__Roles__0=ServiceAdvisor",
      "Auth__Development__Roles__0=Viewer",
      "Auth__Development__Roles__0=",
    ])
    expect(within(card).getByText("--Parameters:auth-development-roles=ServiceAdvisor")).toBeInTheDocument()
    expect(await screen.findByRole("region", { name: "Development user" })).toBeInTheDocument()
    // No Access logout to promise: it could not change a configured identity.
    expect(screen.queryByRole("link", { name: "Sign out" })).not.toBeInTheDocument()
  })
})

describe("settings in the sidebar", () => {
  it("lists Appearance and Account after the Resources pages", async () => {
    vi.useRealTimers()
    renderAt("/settings/account")
    await screen.findByRole("heading", { level: 1, name: "Account" })

    const settings = screen.getByRole("navigation", { name: "Settings" })
    expect(within(settings).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Appearance", "/settings/appearance"],
      ["Account", "/settings/account"],
    ])
    expect(within(settings).getByRole("link", { name: "Account" })).toHaveAttribute("aria-current", "page")
    const labels = screen.getAllByRole("navigation").map((nav) => nav.getAttribute("aria-labelledby") && document.getElementById(nav.getAttribute("aria-labelledby")!)?.textContent)
    expect(labels.filter(Boolean)).toEqual(["Workshop", "Resources", "Settings"])
  })
})
