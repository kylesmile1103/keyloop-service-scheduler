import { focusManager, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"

import type { CurrentUserResponse } from "@/api/types.gen"
import { detailsAccessOf, useCurrentUser, writeAccessOf } from "@/hooks/use-current-user"
import { createQueryClient } from "@/lib/query-client"
import { cachedCapabilities, capabilitiesOf, currentUserQueryKey, NO_ROLE_REASON, READ_ONLY_REASON } from "@/lib/session"
import { admin, anonymous, noRole, serviceAdvisor, viewer } from "@/test/identities"
import { jsonResponse, mockApi } from "@/test/mock-api"

function renderCurrentUser(queryClient = createQueryClient()) {
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  return { ...renderHook(() => useCurrentUser(), { wrapper }), queryClient }
}

const meRequests = (requests: readonly Request[]) => requests.filter((request) => new URL(request.url).pathname === "/api/v1/me")

afterEach(() => {
  focusManager.setFocused(undefined)
})

describe("the current user", () => {
  it("allows nothing while /me is read: write controls wait instead of offering an action they may withdraw", () => {
    mockApi(() => new Promise<Response>(() => {}))
    const { result } = renderCurrentUser()

    expect(result.current.status).toBe("loading")
    expect(writeAccessOf(result.current)).toEqual({ state: "checking" })
    expect(detailsAccessOf(result.current)).toBe("checking")
  })

  it.each<[string, CurrentUserResponse, ReturnType<typeof writeAccessOf>, ReturnType<typeof detailsAccessOf>]>([
    ["anonymous", anonymous, { state: "sign-in" }, "sign-in"],
    ["a signed-in account without a role", noRole, { state: "denied", reason: NO_ROLE_REASON }, "no-role"],
    ["a Viewer", viewer, { state: "denied", reason: READ_ONLY_REASON }, "allowed"],
    ["a Service advisor", serviceAdvisor, { state: "allowed" }, "allowed"],
    ["an Admin", admin, { state: "allowed" }, "allowed"],
  ])("gives %s the writes and details its roles allow", async (_, me, write, details) => {
    mockApi(() => jsonResponse(me))
    const { result } = renderCurrentUser()

    await waitFor(() => expect(result.current.status).toBe("ready"))
    expect(writeAccessOf(result.current)).toEqual(write)
    expect(detailsAccessOf(result.current)).toBe(details)
    expect(result.current.logoutUrl).toBe("/cdn-cgi/access/logout")
  })

  it("treats an unanswered /me as signed out, so writes ask to sign in rather than fail", async () => {
    mockApi(() => new Response("", { status: 502, statusText: "Bad Gateway" }))
    const { result } = renderCurrentUser()

    await waitFor(() => expect(result.current.status).toBe("failed"))
    expect(writeAccessOf(result.current)).toEqual({ state: "sign-in" })
    expect(result.current.logoutUrl).toBeNull()
  })

  it("does not read a failed /me again just because another component asks for it", async () => {
    const api = mockApi(() => new Response("", { status: 502, statusText: "Bad Gateway" }))
    const { result, queryClient } = renderCurrentUser()
    await waitFor(() => expect(result.current.status).toBe("failed"))

    // A view that shows Sign in once the check has failed mounts another reader.
    const second = renderCurrentUser(queryClient)

    // It sees the failure at once (asking again would put the query back to loading, and that reader would ask again).
    expect(second.result.current.status).toBe("failed")
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(meRequests(api.requests)).toHaveLength(1)
  })

  it("counts a failed re-read as failed and signed out, though an earlier answer is still cached", async () => {
    let failing = false
    mockApi(() => (failing ? new Response("", { status: 502, statusText: "Bad Gateway" }) : jsonResponse(admin)))
    const { result, queryClient } = renderCurrentUser()
    await waitFor(() => expect(result.current.canWrite).toBe(true))

    failing = true
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })

    await waitFor(() => expect(result.current.status).toBe("failed"))
    // The answer from before the failure grants nothing any more, here or where a decision reads the cache.
    expect(queryClient.getQueryData(currentUserQueryKey())).toEqual(admin)
    expect(result.current.user).toBeUndefined()
    expect(result.current.authenticated).toBe(false)
    expect(writeAccessOf(result.current)).toEqual({ state: "sign-in" })
    expect(detailsAccessOf(result.current)).toBe("sign-in")
    expect(cachedCapabilities(queryClient)).toEqual(capabilitiesOf(undefined))
    expect(result.current.error).not.toBeNull()

    // Try again: still failed while it reads, then the answer.
    failing = false
    act(() => result.current.refetch())
    expect(result.current.status).toBe("failed")
    await waitFor(() => expect(result.current.status).toBe("ready"))
    expect(result.current.canWrite).toBe(true)
    expect(cachedCapabilities(queryClient).canWrite).toBe(true)
  })

  it("does not read /me again on a later mount after a re-read failed either, though the earlier answer is cached", async () => {
    let failing = false
    const api = mockApi(() => (failing ? new Response("", { status: 502, statusText: "Bad Gateway" }) : jsonResponse(admin)))
    const { result, queryClient } = renderCurrentUser()
    await waitFor(() => expect(result.current.status).toBe("ready"))
    failing = true
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    await waitFor(() => expect(result.current.status).toBe("failed"))

    const second = renderCurrentUser(queryClient)

    expect(second.result.current.status).toBe("failed")
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(meRequests(api.requests)).toHaveLength(2)
  })

  it("counts a read that failed once as failed while it is tried again on its own", async () => {
    let reads = 0
    mockApi(() => (++reads === 2 ? new Response("", { status: 502, statusText: "Bad Gateway" }) : jsonResponse(admin)))
    // The production policy: a failed read is tried once more by itself (lib/query-client.ts), here after 100 ms.
    const queryClient = createQueryClient()
    queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: 1, retryDelay: 100 } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useCurrentUser(), { wrapper })
    await waitFor(() => expect(result.current.canWrite).toBe(true))

    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })

    await waitFor(() => expect(result.current.status).toBe("failed"))
    expect(result.current.fetching).toBe(true)
    expect(cachedCapabilities(queryClient).canWrite).toBe(false)
    await waitFor(() => expect(result.current.status).toBe("ready"))
    expect(reads).toBe(3)
  })

  it("reads /me again when the window regains focus, so a sign-in in another tab is noticed", async () => {
    let me: CurrentUserResponse = anonymous
    const api = mockApi(() => jsonResponse(me))
    const { result } = renderCurrentUser()
    await waitFor(() => expect(result.current.status).toBe("ready"))
    expect(result.current.authenticated).toBe(false)

    me = serviceAdvisor
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })

    await waitFor(() => expect(result.current.canWrite).toBe(true))
    expect(meRequests(api.requests)).toHaveLength(2)
  })
})
