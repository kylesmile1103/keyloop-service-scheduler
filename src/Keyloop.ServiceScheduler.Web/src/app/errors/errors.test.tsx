import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createMemoryRouter } from "react-router-dom"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"

import App from "@/App"
import { appRoutes } from "@/config/routes"
import { ERROR_PAGES, errorPageFor } from "@/lib/error-pages"
import { createQueryClient } from "@/lib/query-client"
import { mockBoardApi } from "@/test/board-api"

// The error pages (Task 29), adopted from the template's errors app: routed, so the app can navigate to them.

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

  it("asks to sign in on a 401, and says that sign-in is not enabled here", async () => {
    const { container } = renderAt(ERROR_PAGES.unauthorized)

    expect(await heading("Sign in to continue")).toBeInTheDocument()
    expect(screen.getByText("Sign-in is not enabled in this environment, so every page is open without it.")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Go to the dispatch board" })).toHaveAttribute("href", "/dispatch")
    expect(container.querySelector('img[src*="closed-day"]')).toHaveAttribute("alt", "")
    expect(document.title).toBe("Sign in to continue – Keyloop Service Scheduler")
  })

  it("says that the account has no access on a 403", async () => {
    renderAt(ERROR_PAGES.forbidden)

    expect(await heading("No access to this page")).toBeInTheDocument()
    expect(screen.getByText("Your role does not include this page. An administrator can give your account access.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Go to the dispatch board" })).toHaveAttribute("href", "/dispatch")
    expect(document.title).toBe("No access to this page – Keyloop Service Scheduler")
  })

  it("names a server failure with its trace id and tries the page again", async () => {
    const { router, container } = renderAt(ERROR_PAGES.internalServerError, { from: "/appointments?dealership=x", traceId })

    expect(await heading("Something went wrong on the server")).toBeInTheDocument()
    expect(screen.getByText(traceId)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Copy trace ID" })).toBeInTheDocument()
    expect(container.querySelector('img[src*="error-connection"]')).toHaveAttribute("alt", "")

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
    expect(screen.getByText("The scheduler is being updated. Bookings already made are kept.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/dispatch"))
  })

  it("restyles the not-found page in the same frame, also at its own address", async () => {
    renderAt(ERROR_PAGES.notFound)

    expect(await heading("Page not found")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Go to the dispatch board" })).toHaveAttribute("href", "/dispatch")
  })

  it("keeps each page inside the app's frame, with its navigation", async () => {
    renderAt(ERROR_PAGES.forbidden)

    await heading("No access to this page")
    expect(screen.getByRole("navigation", { name: "Workshop" })).toBeInTheDocument()
  })
})
