import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createMemoryRouter } from "react-router-dom"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"

import App from "@/App"
import { appRoutes } from "@/config/routes"
import { ERROR_PAGES, errorPageFor } from "@/lib/error-pages"
import { createQueryClient } from "@/lib/query-client"
import { mockBoardApi } from "@/test/board-api"
import { anonymous, noRole } from "@/test/identities"

beforeAll(async () => {
  await Promise.all(
    ["unauthorized", "forbidden", "internal-server-error", "under-maintenance", "not-found"].map((name) => import(`@/app/errors/${name}/page.tsx`))
  )
})

beforeEach(() => {
  mockBoardApi()
})

function renderAt(path: string, state?: unknown) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [{ pathname: path, state }] })
  const view = render(<App router={router} queryClient={createQueryClient()} />)
  return { router, ...view }
}

const heading = (name: string) => screen.findByRole("heading", { level: 1, name })
const traceId = "00-438d4c830068d5c9ac8829d1ed9a62c4-688a07bcce305407-01"

describe("error pages", () => {
  it("routes each one under /errors", () => {
    expect(ERROR_PAGES).toEqual({
      unauthorized: "/errors/unauthorized",
      forbidden: "/errors/forbidden",
      notFound: "/errors/not-found",
      internalServerError: "/errors/internal-server-error",
      underMaintenance: "/errors/under-maintenance",
    })
    expect([401, 403, 404, 500, 502, 503, 400, 409].map(errorPageFor)).toEqual([
      "/errors/unauthorized",
      "/errors/forbidden",
      "/errors/not-found",
      "/errors/internal-server-error",
      "/errors/internal-server-error",
      "/errors/under-maintenance",
      null,
      null,
    ])
  })

  it("asks to sign in on a 401, returning to the dispatch board when no page sent the user", async () => {
    mockBoardApi({ me: () => anonymous })
    const { container } = renderAt(ERROR_PAGES.unauthorized)

    expect(await heading("Sign in to continue")).toBeInTheDocument()
    expect(screen.getByText("This page needs you to be signed in with a workshop account.")).toBeInTheDocument()
    expect(screen.getByText(/booking, cancelling and the Resources area need an account/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login?returnTo=%2Fdispatch")
    expect(screen.queryByRole("link", { name: "Go to the dispatch board" })).not.toBeInTheDocument()
    expect(screen.queryByText(/does not offer sign-in/)).not.toBeInTheDocument()
    expect(container.querySelector("main img, #content img")).toHaveAttribute("alt", "Car key fob beside an open padlock inviting sign-in.")
    expect(document.title).toBe("Sign in to continue – Keyloop Service Scheduler")
  })

  it("signs in back to the page that sent the user to the 401 page, with its search", async () => {
    mockBoardApi({ me: () => anonymous })
    renderAt(ERROR_PAGES.unauthorized, { from: "/appointments?dealership=x&date=2026-10-14" })

    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/auth/login?returnTo=%2Fappointments%3Fdealership%3Dx%26date%3D2026-10-14"
    )
  })

  it("says that the account has no access on a 403, and that the workshop administrator assigns roles", async () => {
    mockBoardApi({ me: () => noRole })
    renderAt(ERROR_PAGES.forbidden)

    expect(await heading("No access to this page")).toBeInTheDocument()
    expect(await screen.findByText(/You are signed in as Robin Visitor, but your account’s role does not include this page\./)).toBeInTheDocument()
    expect(screen.getByText("Roles (Admin, Service advisor, Viewer) are assigned by the workshop administrator: ask them for access.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Go to the dispatch board" })).toHaveAttribute("href", "/dispatch")
    expect(document.title).toBe("No access to this page – Keyloop Service Scheduler")
  })

  it("names a server failure with its trace id and tries the page again", async () => {
    const { router, container } = renderAt(ERROR_PAGES.internalServerError, { from: "/appointments?dealership=x", traceId })

    expect(await heading("Something went wrong on the server")).toBeInTheDocument()
    expect(screen.getByText(traceId)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Copy trace ID" })).toBeInTheDocument()
    expect(container.querySelectorAll("img")).toHaveLength(1)

    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/appointments"))
    expect(router.state.location.search).toBe("?dealership=x")
  })

  it("leads to the dispatch board from a server failure it was not sent to with a page to retry", async () => {
    renderAt(ERROR_PAGES.internalServerError)

    expect(await heading("Something went wrong on the server")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Go to the dispatch board" })).toHaveAttribute("href", "/dispatch")
  })

  it("says that the scheduler is down for maintenance and that bookings are kept", async () => {
    const { router } = renderAt(ERROR_PAGES.underMaintenance, { from: "/dispatch" })

    expect(await heading("Down for maintenance")).toBeInTheDocument()
    expect(screen.getByText("The scheduler is temporarily unavailable. Bookings already made are kept.")).toBeInTheDocument()
    expect(screen.getByText("Try again in a moment.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/dispatch"))
  })

  it("restyles the not-found page in the same frame, also at its own address", async () => {
    renderAt(ERROR_PAGES.notFound)

    expect(await heading("Page not found")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Go to the dispatch board" })).toHaveAttribute("href", "/dispatch")
  })

  it("breaks the missing path only between its segments, the full stop staying with the last one", async () => {
    renderAt("/workshop/requirement-policy/a1b2-c3d4")

    expect(await heading("Page not found")).toBeInTheDocument()
    const line = screen.getByText(/^Nothing lives at/)
    expect(line).toHaveTextContent("Nothing lives at /workshop/requirement-policy/a1b2-c3d4.")
    const code = line.querySelector("code")!
    expect(code).toHaveTextContent("/workshop/requirement-policy/a1b2-c3d4.")
    expect(code).not.toHaveClass("break-all")
    const boxes = Array.from(code.children).filter((child) => child.tagName === "SPAN")
    expect(boxes.map((box) => box.textContent)).toEqual(["/workshop", "/requirement-policy", "/a1b2-c3d4."])
    for (const box of boxes) expect(box).toHaveClass("inline-block", "max-w-full", "wrap-anywhere")
    expect(code.querySelectorAll(":scope > wbr")).toHaveLength(2)
  })

  it.each([
    [401, ERROR_PAGES.unauthorized, "Sign in to continue", "unauthorized.webp", "Car key fob beside an open padlock inviting sign-in."],
    [403, ERROR_PAGES.forbidden, "No access to this page", "forbidden.webp", "Workshop bay behind a safety barrier with a wrench role badge."],
    [404, ERROR_PAGES.notFound, "Page not found", "not-found.webp", "Directional road sign pointing toward a short road closed by a barrier."],
    [500, ERROR_PAGES.internalServerError, "Something went wrong on the server", "server-error.webp", "Generic silver hatchback with an open bonnet, a steam wisp and a nearby wrench."],
    [503, ERROR_PAGES.underMaintenance, "Down for maintenance", "maintenance.webp", "Silver hatchback raised on a two-post lift beside cones and a progress indicator."],
  ])("shows the %i page its own illustration, with its alt text", async (_status, path, title, file, alt) => {
    const { container } = renderAt(path)

    expect(await heading(title)).toBeInTheDocument()
    const picture = screen.getByRole("img", { name: alt })
    expect(picture.getAttribute("src")).toMatch(new RegExp(`/${file.replace(".", "\\.")}$`))
    expect(picture).toHaveAttribute("width", "1200")
    expect(picture).toHaveAttribute("height", "900")
    expect(container.querySelectorAll("main img")).toHaveLength(1)
    expect(container.querySelector("main svg.lucide-key-round, main svg.lucide-lock-keyhole, main svg.lucide-construction")).toBeNull()
  })

  it("shows every other server failure (5xx) the server-error page", () => {
    expect([500, 502, 504, 599].map(errorPageFor)).toEqual(Array(4).fill(ERROR_PAGES.internalServerError))
  })

  it("keeps each page inside the app's frame, with its navigation", async () => {
    renderAt(ERROR_PAGES.forbidden)

    await heading("No access to this page")
    expect(screen.getByRole("navigation", { name: "Workshop" })).toBeInTheDocument()
  })
})
