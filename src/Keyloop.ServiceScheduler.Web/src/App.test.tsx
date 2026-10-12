import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { createMemoryRouter } from "react-router-dom"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"

import App from "@/App"
import { appRoutes } from "@/config/routes"
import { createQueryClient } from "@/lib/query-client"
import { mockBoardApi } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { viewportOf } from "@/test/render-board"

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const view = render(<App router={router} queryClient={createQueryClient()} />)
  return { router, ...view }
}

// The board's route is lazy: load its code once up front, so each test's wait measures rendering, not the first,
// cold compile of the page's modules (about 0.4 s, more on a busy machine).
beforeAll(async () => {
  await import("@/app/dispatch/page")
})

// The dispatch board lists dealerships as it opens.
beforeEach(() => {
  mockBoardApi()
})

const pageHeading = (name: string) => screen.findByRole("heading", { level: 1, name })

describe("app shell", () => {
  it("opens on the dispatch board", async () => {
    const { router } = renderAt("/")

    expect(await pageHeading("Dispatch board")).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/dispatch")
    expect(await screen.findByRole("heading", { level: 2, name: reading.name })).toBeInTheDocument()
    expect(document.title).toBe("Dispatch board – Keyloop Service Scheduler")
  })

  it("names the product in the header: the Ownership domain tag, Service Scheduler and the Keyloop wordmark in plain text", async () => {
    const { container } = renderAt("/dispatch")
    await pageHeading("Dispatch board")

    // The header sits inside the work surface's <main>, so it is not a banner landmark.
    const header = document.querySelector<HTMLElement>("header")!
    // Written in sentence case and upper-cased by CSS, so screen readers say the word, not its letters.
    expect(within(header).getByText("Ownership")).toHaveClass("domain-tag", "domain-tag-ownership")
    expect(within(header).getByText("Service Scheduler")).toBeInTheDocument()
    expect(within(header).getByText("Keyloop").tagName).toBe("SPAN")
    // The wordmark is never a link (to keyloop.com or anywhere), and no image is a logo: every image is decorative.
    expect(screen.queryByRole("link", { name: /Keyloop/ })).not.toBeInTheDocument()
    const images = [...container.querySelectorAll("img")]
    expect(images.length).toBeGreaterThan(0)
    for (const image of images) expect(image).toHaveAttribute("alt", "")
  })

  it("says in the sidebar that this is a take-home demo, not an official Keyloop product", async () => {
    renderAt("/dispatch")
    await pageHeading("Dispatch board")

    const sidebar = document.querySelector<HTMLElement>('[data-slot="sidebar"]')!
    expect(within(sidebar).getByText(/^Take-home demo .* not an official Keyloop product$/)).toBeInTheDocument()
  })

  it("lists the Workshop pages and marks the current one", async () => {
    renderAt("/dispatch")
    await pageHeading("Dispatch board")
    await screen.findByRole("heading", { level: 2, name: reading.name })

    // Both pages show one dealership's day, so the links carry the dealership (and the day, when it is not today).
    const workshop = screen.getByRole("navigation", { name: "Workshop" })
    const board = within(workshop).getByRole("link", { name: "Dispatch board" })
    const appointments = within(workshop).getByRole("link", { name: "Appointments" })
    await waitFor(() => expect(board).toHaveAttribute("href", `/dispatch?dealership=${reading.id}`))
    expect(board).toHaveAttribute("aria-current", "page")
    expect(appointments).toHaveAttribute("href", `/appointments?dealership=${reading.id}`)
    expect(appointments).not.toHaveAttribute("aria-current")
  })

  it("lists the Resources pages after the Workshop ones, carrying the dealership but not the day", async () => {
    renderAt(`/dispatch?dealership=${reading.id}&date=2026-10-14`)
    await pageHeading("Dispatch board")

    const resources = screen.getByRole("navigation", { name: "Resources" })
    expect(within(resources).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Technicians", `/resources/technicians?dealership=${reading.id}`],
      ["Bays", `/resources/bays?dealership=${reading.id}`],
      ["Services", `/resources/services?dealership=${reading.id}`],
    ])
    const groups = screen.getAllByRole("navigation").map((nav) => nav.getAttribute("aria-labelledby") && nav.textContent)
    expect(groups.findIndex((text) => text?.startsWith("Technicians"))).toBeGreaterThan(groups.findIndex((text) => text?.startsWith("Dispatch board")))
  })

  it("moves between pages from the sidebar", async () => {
    const { router } = renderAt("/dispatch")
    await pageHeading("Dispatch board")

    fireEvent.click(screen.getByRole("link", { name: "Appointments" }))

    expect(await pageHeading("Appointments")).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/appointments")
    expect(screen.getByRole("link", { name: "Appointments" })).toHaveAttribute("aria-current", "page")
  })

  it("opens the API reference (Scalar) in a new tab", async () => {
    renderAt("/dispatch")
    await pageHeading("Dispatch board")

    const reference = screen.getByRole("link", { name: /API reference/ })
    expect(reference).toHaveAttribute("href", "/scalar/v1")
    expect(reference).toHaveAttribute("target", "_blank")
    expect(reference.getAttribute("rel")).toContain("noopener")
    expect(reference).toHaveAccessibleName(/opens in a new tab/)
  })

  it("says plainly that sign-in is not enabled", async () => {
    renderAt("/dispatch")
    await pageHeading("Dispatch board")

    expect(screen.getByText("Anonymous mode")).toBeInTheDocument()
  })

  it("offers a skip link to the page content", async () => {
    renderAt("/dispatch")
    await pageHeading("Dispatch board")

    const skip = screen.getByRole("link", { name: "Skip to content" })
    const target = document.querySelector(skip.getAttribute("href") ?? "#missing")
    expect(target).not.toBeNull()
    expect(target).toContainElement(screen.getByRole("heading", { level: 1 }))
  })

  it("switches between light and dark themes and remembers the choice", async () => {
    renderAt("/dispatch")
    await pageHeading("Dispatch board")

    fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }))

    expect(document.documentElement).toHaveClass("dark")
    expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeInTheDocument()
    expect(localStorage.getItem("keyloop-scheduler-theme")).toBe("dark")
  })

  it("shows a not-found page with the address, an illustration and a way back", async () => {
    const { container } = renderAt("/no-such-page")

    expect(await pageHeading("Page not found")).toBeInTheDocument()
    expect(screen.getByText("/no-such-page")).toBeInTheDocument()
    expect(container.querySelector('img[src$="/not-found.webp"]')).toHaveAttribute(
      "alt",
      "Directional road sign pointing toward a short road closed by a barrier."
    )
    expect(screen.getByRole("link", { name: "Go to the dispatch board" })).toHaveAttribute("href", "/dispatch")
    expect(document.title).toBe("Page not found – Keyloop Service Scheduler")
  })
})

describe("app shell across widths", () => {
  const sidebar = () => document.querySelector<HTMLElement>('[data-slot="sidebar"]')!
  const sidebarPanel = () => document.querySelector<HTMLElement>('[data-slot="sidebar-container"]')!

  it("shows the sidebar expanded on a wide screen", async () => {
    viewportOf(1440)
    renderAt("/dispatch")
    await pageHeading("Dispatch board")

    expect(sidebar()).toHaveAttribute("data-state", "expanded")
    expect(sidebarPanel()).not.toHaveAttribute("inert")
  })

  it("keeps the sidebar off-canvas on a tablet until the header's button opens it", async () => {
    viewportOf(1024)
    renderAt("/dispatch")
    await pageHeading("Dispatch board")

    // Collapsed off-canvas, its links are out of the tab order as well as out of sight.
    expect(sidebar()).toHaveAttribute("data-state", "collapsed")
    expect(sidebarPanel()).toHaveAttribute("inert")

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }))

    expect(sidebar()).toHaveAttribute("data-state", "expanded")
    expect(sidebarPanel()).not.toHaveAttribute("inert")
  })
})
