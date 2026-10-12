import { screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { mockBoardApi } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { renderBoard } from "@/test/render-board"

// Refine core belongs to the resources subtree (ADR-030, ADR-031): this file never imports it, so the flag below says
// whether anything the app loaded did.
const refine = vi.hoisted(() => ({ loaded: false }))
vi.mock("@refinedev/core", async (importOriginal) => {
  refine.loaded = true
  return importOriginal()
})

// The workshop pages' code loads once up front (it never loads Refine); the resources pages' code is left cold, so the
// flag can tell when it loads, and its waits allow for a first compile on a busy machine.
beforeAll(async () => {
  await Promise.all([import("@/app/dispatch/page"), import("@/app/appointments/page")])
})
const cold = { timeout: 10_000 }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

describe("the resources area's code", () => {
  it("is never loaded by the dispatch board or the appointments list, and is by a resources page", async () => {
    mockBoardApi()
    const { router } = renderBoard(`/dispatch?dealership=${reading.id}`)
    expect(await screen.findByRole("heading", { level: 2, name: reading.name })).toBeInTheDocument()

    await router.navigate(`/appointments?dealership=${reading.id}`)
    expect(await screen.findByRole("table", { name: "Appointments" })).toBeInTheDocument()
    expect(refine.loaded).toBe(false)

    await router.navigate(`/resources/technicians?dealership=${reading.id}`)
    expect(await screen.findByRole("table", { name: "Technicians" }, cold)).toBeInTheDocument()
    expect(refine.loaded).toBe(true)
  })

  it("opens on the technicians from the section's own address, keeping the dealership", async () => {
    mockBoardApi()
    const { router } = renderBoard(`/resources?dealership=${reading.id}`)

    expect(await screen.findByRole("table", { name: "Technicians" }, cold)).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe("/resources/technicians"))
    expect(router.state.location.search).toBe(`?dealership=${reading.id}`)
  })
})
