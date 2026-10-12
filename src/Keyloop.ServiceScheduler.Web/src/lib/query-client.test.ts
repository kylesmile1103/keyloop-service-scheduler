import { describe, expect, it } from "vitest"

import { createQueryClient, queryClient } from "@/lib/query-client"

describe("query client defaults", () => {
  it("keeps query results fresh for two seconds and retries a failed read once", () => {
    const { queries } = createQueryClient().getDefaultOptions()

    expect(queries?.staleTime).toBe(2000)
    expect(queries?.retry).toBe(1)
  })

  it("never retries a mutation, so a booking is never submitted twice by the client", () => {
    expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(0)
  })

  it("shares one configured client across the app", () => {
    expect(queryClient.getDefaultOptions()).toEqual(createQueryClient().getDefaultOptions())
  })
})
