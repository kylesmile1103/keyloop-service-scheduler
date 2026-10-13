import { render, screen, within } from "@testing-library/react"
import { createMemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import App from "@/App"
import { appRoutes } from "@/config/routes"

// Simulate a route error boundary failure via a throwing page component.
vi.mock("@/app/appointments/page", () => ({
  default: function BrokenPage(): never {
    throw new Error("Appointments page failed: unexpected response shape")
  },
}))

describe("a page that fails", () => {
  it("shows what failed and a reload action instead of a blank screen", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {}) // React and React Router log the caught error
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/appointments"] })

    render(<App router={router} />)

    const alert = await screen.findByRole("alert")
    expect(within(alert).getByRole("heading", { level: 1, name: "Something went wrong" })).toBeInTheDocument()
    expect(within(alert).getByText("Appointments page failed: unexpected response shape")).toBeInTheDocument()
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument()
    expect(document.querySelector('img[src*="error-connection"]')).toHaveAttribute("alt", "")
  })
})
