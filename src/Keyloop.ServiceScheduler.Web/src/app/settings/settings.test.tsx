import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { createMemoryRouter } from "react-router-dom"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import App from "@/App"
import { appRoutes } from "@/config/routes"
import { createQueryClient } from "@/lib/query-client"
import { mockBoardApi } from "@/test/board-api"

// The Settings pages (Task 29): Appearance (the theme) and the Account placeholder that Task 27b fills.

beforeAll(async () => {
  await Promise.all([import("@/app/settings/appearance/page"), import("@/app/settings/account/page")])
})

beforeEach(() => {
  mockBoardApi()
})

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  render(<App router={router} queryClient={createQueryClient()} />)
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
  it("says plainly that sign-in is not enabled, and what the page will show once it is", async () => {
    renderAt("/settings/account")

    expect(await screen.findByRole("heading", { level: 1, name: "Account" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 2, name: "Anonymous mode" })).toBeInTheDocument()
    const facts = screen.getByRole("list", { name: "Your account" })
    expect(within(facts).getByText("Signed in as").nextElementSibling).toHaveTextContent("Not signed in")
    expect(within(facts).getByText("Roles").nextElementSibling).toHaveTextContent("None")
    expect(screen.getByText(/Admin, Service advisor or Viewer/)).toBeInTheDocument()
    // A placeholder: no made-up user and nothing to edit.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /save|delete/i })).not.toBeInTheDocument()
    expect(document.title).toBe("Account – Keyloop Service Scheduler")
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
