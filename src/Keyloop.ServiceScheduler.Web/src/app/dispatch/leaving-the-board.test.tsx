import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createMemoryRouter } from "react-router-dom"
import { beforeAll, describe, expect, it, vi } from "vitest"

import App from "@/App"
import { appRoutes } from "@/config/routes"
import { createQueryClient } from "@/lib/query-client"
import { munich, reading } from "@/test/dealerships"
import { jsonResponse, mockApi } from "@/test/mock-api"

// Holds the Appointments page's code until the test releases it, like a slow network: the navigation stays pending.
const appointmentsChunk = vi.hoisted(() => ({ release: () => {} }))
vi.mock("@/app/appointments/page", async (importOriginal) => {
  await new Promise<void>((resolve) => (appointmentsChunk.release = resolve))
  return importOriginal()
})

// The board's route is lazy: load its code once up front, so each test's wait measures rendering, not the first,
// cold compile of the page's modules (about 0.4 s, more on a busy machine).
beforeAll(async () => {
  await import("@/app/dispatch/page")
})

describe("leaving the dispatch board", () => {
  it("is not undone by the board selecting a dealership while the next page loads", async () => {
    let answer: (response: Response) => void = () => {}
    mockApi(() => new Promise<Response>((resolve) => (answer = resolve)))
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/dispatch"] })
    render(<App router={router} queryClient={createQueryClient()} />)
    await screen.findByRole("heading", { level: 1, name: "Dispatch Board" })

    fireEvent.click(screen.getByRole("link", { name: "Appointments" }))
    await waitFor(() => expect(router.state.navigation.state).toBe("loading"))
    answer(jsonResponse([reading, munich]))
    await screen.findByRole("heading", { level: 2, name: reading.name })
    appointmentsChunk.release()

    expect(await screen.findByRole("heading", { level: 1, name: "Appointments" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/appointments")
  })
})
