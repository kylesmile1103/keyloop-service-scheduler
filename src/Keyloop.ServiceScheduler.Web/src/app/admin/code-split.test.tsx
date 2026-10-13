import { screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { mockBoardApi } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { renderBoard } from "@/test/render-board"

// Track whether Refine core is loaded when navigating across routes.
const refine = vi.hoisted(() => ({ loaded: false }))
vi.mock("@refinedev/core", async (importOriginal) => {
  refine.loaded = true
  return importOriginal()
})

// Preload workshop routes while leaving resource routes lazy-loaded.
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
