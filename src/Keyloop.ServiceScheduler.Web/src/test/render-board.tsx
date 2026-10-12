import { fireEvent, render, screen } from "@testing-library/react"
import { StrictMode } from "react"
import { createMemoryRouter } from "react-router-dom"
import { vi } from "vitest"

import { getDealershipsQueryKey } from "@/api/@tanstack/react-query.gen"
import App from "@/App"
import { appRoutes } from "@/config/routes"
import { createQueryClient } from "@/lib/query-client"
import { matchesWidth } from "@/test/media-query"

/** Renders the app at a dispatch-board address, under StrictMode as main.tsx does, with a fresh query client. */
export function renderBoard(path = "/dispatch", { cached }: { cached?: unknown } = {}) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const queryClient = createQueryClient()
  if (cached) queryClient.setQueryData(getDealershipsQueryKey(), cached)
  // Failures show at once; the production retry policy is covered by lib/query-client.test.ts.
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  render(
    <StrictMode>
      <App router={router} queryClient={queryClient} />
    </StrictMode>
  )
  return { router, queryClient }
}

export type RenderedBoard = ReturnType<typeof renderBoard>

/** The address's search parameters, as an object. */
export const search = (router: RenderedBoard["router"]) => Object.fromEntries(new URLSearchParams(router.state.location.search))

/** A mouse choosing an option or item: Base UI selects on a click that started on it (pointerdown, then click). */
export function pointerClick(element: Element) {
  fireEvent.pointerDown(element, { pointerType: "mouse" })
  fireEvent.click(element)
}

/** Answers every width media query for a viewport this wide (other features do not match), as a phone or tablet would. */
export function viewportOf(width: number) {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: matchesWidth(query, width),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}

/** A 390 px phone: `useIsMobile` (max-width 767px) answers yes. */
export const phoneViewport = () => viewportOf(390)

/** The board's heading once the selected dealership's day is on screen. */
export const boardHeading = (name: string) => screen.findByRole("heading", { level: 2, name })
