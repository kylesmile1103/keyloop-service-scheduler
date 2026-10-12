import { render, screen } from "@testing-library/react"
import { createMemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import App from "@/App"
import { appRoutes } from "@/config/routes"
import { ERROR_PAGES } from "@/lib/error-pages"
import { createQueryClient } from "@/lib/query-client"
import { mockBoardApi } from "@/test/board-api"

// Task 27b wires sign-in: once the session knows where to sign in, the 401 page's one action is Sign in.
vi.mock("@/lib/session", () => ({ signInUrl: () => "/cdn-cgi/access/login" }))

describe("the unauthorized page with sign-in enabled", () => {
  it("offers Sign in, to the configured address, as its one action", async () => {
    mockBoardApi()
    render(<App router={createMemoryRouter(appRoutes, { initialEntries: [ERROR_PAGES.unauthorized] })} queryClient={createQueryClient()} />)

    expect(await screen.findByRole("heading", { level: 1, name: "Sign in to continue" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/cdn-cgi/access/login")
    expect(screen.queryByText(/Sign-in is not enabled/)).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Go to the dispatch board" })).not.toBeInTheDocument()
  })
})
