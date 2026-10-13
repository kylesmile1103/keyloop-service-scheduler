import { useList, useResourceParams } from "@refinedev/core"
import { useQueryClient } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { StrictMode } from "react"
import { createMemoryRouter, Outlet } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import App from "@/App"
import { RootLayout } from "@/components/router/root-layout"
import { createQueryClient } from "@/lib/query-client"
import { mockBoardApi } from "@/test/board-api"
import { reading } from "@/test/dealerships"

import AdminLayout from "./layout"
import type { TechnicianRecord } from "./lib/resources"

const date = "2026-10-13"

/** A page inside the admin layout that reports what Refine sees. */
function Probe() {
  const outer = useQueryClient()
  const { resource, action } = useResourceParams()
  const { result, query } = useList<TechnicianRecord>({
    resource: "technicians",
    pagination: { mode: "off" },
    meta: { dealershipId: reading.id, date },
  })
  return (
    <dl>
      <dt>Resource</dt>
      <dd>{`${resource?.name ?? "none"} ${action ?? "none"}`}</dd>
      <dt>Technicians</dt>
      <dd>{query.isSuccess ? result.data.map((record) => record.name).join(", ") : "loading"}</dd>
      <dt>Client</dt>
      <dd data-testid="client">{outer === sharedClient ? "shared" : "another"}</dd>
    </dl>
  )
}

let sharedClient = createQueryClient()

function renderAdmin(path = `/resources/technicians?dealership=${reading.id}`) {
  sharedClient = createQueryClient()
  const router = createMemoryRouter(
    [
      {
        element: <RootLayout />,
        children: [
          { path: "/resources", Component: AdminLayout, children: [{ path: "technicians", Component: Probe }] },
          { path: "/elsewhere", element: <Outlet /> },
        ],
      },
    ],
    { initialEntries: [path] }
  )
  render(
    <StrictMode>
      <App router={router} queryClient={sharedClient} />
    </StrictMode>
  )
  return router
}

/** Every way a page could send something out, watched for the test. */
function watchOutgoing() {
  const images: string[] = []
  const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!
  vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(function (this: HTMLImageElement, value: string) {
    images.push(new URL(value, window.location.href).href)
    descriptor.set!.call(this, value)
  })
  const beacons = vi.fn(() => true)
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacons })
  const xhr = vi.spyOn(XMLHttpRequest.prototype, "open")
  const sockets = vi.fn()
  vi.stubGlobal(
    "WebSocket",
    class {
      constructor(url: string) {
        sockets(url)
      }
    }
  )
  return { images, beacons, xhr, sockets }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

describe("Refine in the resources area", () => {
  it("reads the current resource from the address through the React Router binding, and lists it through the data provider", async () => {
    mockBoardApi()
    renderAdmin()

    expect(await screen.findByText("Amelia Clarke, Ben Okafor, Chloe Nguyen, Daniel Moss, Eva Lindqvist, Farid Haddad")).toBeInTheDocument()
    expect(screen.getByText("technicians list")).toBeInTheDocument()
  })

  it("shares the app's QueryClient: one cache for Refine's lists and the board's reads", async () => {
    mockBoardApi()
    renderAdmin()

    await screen.findByText(/Amelia Clarke/)
    expect(screen.getByTestId("client")).toHaveTextContent("shared")
    const keys = sharedClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey)
    // Refine's list query and the generated schedule read it made are entries of the same cache.
    expect(keys).toContainEqual(expect.arrayContaining(["data", "default", "technicians", "list"]))
    expect(keys).toContainEqual([expect.objectContaining({ _id: "getWorkshopSchedule", path: { dealershipId: reading.id }, query: { date } })])
  })

  it("sends nothing to any origin but the app's own: Refine's telemetry is off and no devtools connect", async () => {
    const outgoing = watchOutgoing()
    const { requests } = mockBoardApi()
    renderAdmin()

    await screen.findByText(/Amelia Clarke/)
    // Refine sends its telemetry from an effect after the first render; give every effect and microtask time to run.
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(requests.length).toBeGreaterThan(0)
    expect(requests.map((request) => new URL(request.url).origin)).toEqual(requests.map(() => window.location.origin))
    expect(outgoing.images.filter((src) => new URL(src).origin !== window.location.origin)).toEqual([])
    expect(outgoing.beacons).not.toHaveBeenCalled()
    expect(outgoing.xhr).not.toHaveBeenCalled()
    expect(outgoing.sockets).not.toHaveBeenCalled()
  })
})
