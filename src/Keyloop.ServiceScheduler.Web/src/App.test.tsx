import { fireEvent, render, screen, within } from "@testing-library/react"
import { createMemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import App from "@/App"
import { appRoutes } from "@/config/routes"

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const view = render(<App router={router} />)
  return { router, ...view }
}

const pageHeading = (name: string) => screen.findByRole("heading", { level: 1, name })

describe("app shell", () => {
  it("opens on the dispatch board", async () => {
    const { router } = renderAt("/")

    expect(await pageHeading("Dispatch Board")).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/dispatch")
    expect(document.title).toBe("Dispatch Board – Keyloop Service Scheduler")
  })

  it("brands the sidebar with the Keyloop text wordmark and no logo images", async () => {
    const { container } = renderAt("/dispatch")
    await pageHeading("Dispatch Board")

    const home = screen.getByRole("link", { name: /Keyloop.*Service Scheduler/ })
    expect(home).toHaveAttribute("href", "/dispatch")
    expect(container.querySelector("img")).toBeNull()
  })

  it("lists the Workshop pages and marks the current one", async () => {
    renderAt("/dispatch")
    await pageHeading("Dispatch Board")

    const workshop = screen.getByRole("navigation", { name: "Workshop" })
    const board = within(workshop).getByRole("link", { name: "Dispatch Board" })
    const appointments = within(workshop).getByRole("link", { name: "Appointments" })
    expect(board).toHaveAttribute("href", "/dispatch")
    expect(board).toHaveAttribute("aria-current", "page")
    expect(appointments).toHaveAttribute("href", "/appointments")
    expect(appointments).not.toHaveAttribute("aria-current")
  })

  it("moves between pages from the sidebar", async () => {
    const { router } = renderAt("/dispatch")
    await pageHeading("Dispatch Board")

    fireEvent.click(screen.getByRole("link", { name: "Appointments" }))

    expect(await pageHeading("Appointments")).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/appointments")
    expect(screen.getByRole("link", { name: "Appointments" })).toHaveAttribute("aria-current", "page")
  })

  it("opens the API reference (Scalar) in a new tab", async () => {
    renderAt("/dispatch")
    await pageHeading("Dispatch Board")

    const reference = screen.getByRole("link", { name: /API reference/ })
    expect(reference).toHaveAttribute("href", "/scalar/v1")
    expect(reference).toHaveAttribute("target", "_blank")
    expect(reference.getAttribute("rel")).toContain("noopener")
    expect(reference).toHaveAccessibleName(/opens in a new tab/)
  })

  it("says plainly that sign-in is not enabled", async () => {
    renderAt("/dispatch")
    await pageHeading("Dispatch Board")

    expect(screen.getByText("Anonymous mode")).toBeInTheDocument()
  })

  it("offers a skip link to the page content", async () => {
    renderAt("/dispatch")
    await pageHeading("Dispatch Board")

    const skip = screen.getByRole("link", { name: "Skip to content" })
    const target = document.querySelector(skip.getAttribute("href") ?? "#missing")
    expect(target).not.toBeNull()
    expect(target).toContainElement(screen.getByRole("heading", { level: 1 }))
  })

  it("switches between light and dark themes and remembers the choice", async () => {
    renderAt("/dispatch")
    await pageHeading("Dispatch Board")

    fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }))

    expect(document.documentElement).toHaveClass("dark")
    expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeInTheDocument()
    expect(localStorage.getItem("keyloop-scheduler-theme")).toBe("dark")
  })

  it("shows a not-found page with a way back for an unknown address", async () => {
    renderAt("/no-such-page")

    expect(await pageHeading("Page not found")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Go to the dispatch board" })).toHaveAttribute("href", "/dispatch")
  })
})
