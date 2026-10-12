import { focusManager, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"

import type { CurrentUserResponse } from "@/api/types.gen"
import { detailsAccessOf, useCurrentUser, writeAccessOf } from "@/hooks/use-current-user"
import { createQueryClient } from "@/lib/query-client"
import { NO_ROLE_REASON, READ_ONLY_REASON } from "@/lib/session"
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
