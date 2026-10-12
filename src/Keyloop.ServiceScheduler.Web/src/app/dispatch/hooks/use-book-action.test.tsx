import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import type { CurrentUserResponse } from "@/api/types.gen"
import { IDENTITY_CHECK_FAILED } from "@/components/auth/identity-check-failed"
import { currentUserQueryKey, READ_ONLY_REASON } from "@/lib/session"
import { mockBoardApi } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { anonymous, serviceAdvisor, viewer } from "@/test/identities"

import { type BookAction, useBookAction } from "./use-book-action"

// A Book action decides when it is pressed, from the `/me` the cache holds at that moment (Task 28b review round 1): a
// press can land after `/me` changed but before React has drawn the change (TanStack tells the views on a zero timeout),
// and then the action the page last drew is the previous caller's.

type Caller = CurrentUserResponse | "unreadable"

/** The hook in a bare page: its reason and its dialogs on screen, the latest render's action in `latest.action`. */
function renderBookAction(caller: () => Caller) {
  const api = mockBoardApi({
    me: () => {
      const me = caller()
      return me === "unreadable" ? new Response("", { status: 502, statusText: "Bad Gateway" }) : me
    },
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const latest: { action: BookAction | null } = { action: null }
  function Page() {
    const action = useBookAction({ dealership: reading, today: "2026-10-13", fullScreen: false })
    latest.action = action
    return (
      <>
        {action.reason}
        {action.dialogs}
      </>
    )
  }
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Page />
      </MemoryRouter>
    </QueryClientProvider>
  )
  return { api, queryClient, latest }
}

/**
 * Reads `/me` again (answered by the test's caller) and, in the same task, calls the action the page last drew: the press
 * that lands before React has rendered the new answer. Returns the access that drawn action carried.
 */
async function openAfterRereadBeforeRender(queryClient: QueryClient, latest: { action: BookAction | null }, day?: string) {
  let drawn: BookAction["access"]["state"] | undefined
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: currentUserQueryKey() })
    drawn = latest.action?.access.state
    latest.action?.open(day)
  })
  return drawn
}

const writes = (requests: readonly Request[]) => requests.filter((request) => request.method !== "GET")

describe("useBookAction's open, decided from the cached /me when it is called", () => {
  it("opens the booking dialog for a caller who may still book", async () => {
    const { queryClient, latest } = renderBookAction(() => serviceAdvisor)
    await waitFor(() => expect(latest.action?.access.state).toBe("allowed"))

    expect(await openAfterRereadBeforeRender(queryClient, latest, "2026-10-14")).toBe("allowed")

    expect(await screen.findByRole("dialog", { name: "Book appointment" })).toBeInTheDocument()
  })

  it("asks a caller who signed out to sign in, though the page last drew a caller who could book", async () => {
    let me: Caller = serviceAdvisor
    const { api, queryClient, latest } = renderBookAction(() => me)
    await waitFor(() => expect(latest.action?.access.state).toBe("allowed"))

    me = anonymous
    expect(await openAfterRereadBeforeRender(queryClient, latest)).toBe("allowed")

    expect(await screen.findByRole("dialog", { name: "Sign in to book" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Book appointment" })).not.toBeInTheDocument()
    expect(writes(api.requests)).toHaveLength(0)
  })

  it("opens nothing for a caller who became a Viewer, and the page then names the role's reason", async () => {
    let me: Caller = serviceAdvisor
    const { api, queryClient, latest } = renderBookAction(() => me)
    await waitFor(() => expect(latest.action?.access.state).toBe("allowed"))

    me = viewer
    expect(await openAfterRereadBeforeRender(queryClient, latest)).toBe("allowed")

    expect(await screen.findByText(READ_ONLY_REASON)).toBeInTheDocument()
    expect(latest.action?.access.state).toBe("denied")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(writes(api.requests)).toHaveLength(0)
  })

  it("asks to sign in, saying the check failed, when /me could not be read again", async () => {
    let me: Caller = serviceAdvisor
    const { api, queryClient, latest } = renderBookAction(() => me)
    await waitFor(() => expect(latest.action?.access.state).toBe("allowed"))

    me = "unreadable"
    expect(await openAfterRereadBeforeRender(queryClient, latest)).toBe("allowed")

    const prompt = await screen.findByRole("dialog", { name: "Sign in to book" })
    expect(within(prompt).getByText(IDENTITY_CHECK_FAILED)).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Book appointment" })).not.toBeInTheDocument()
    expect(writes(api.requests)).toHaveLength(0)
  })

  it("opens the booking dialog for a visitor who has just signed in as a role that books, before the page drew it", async () => {
    let me: Caller = anonymous
    const { queryClient, latest } = renderBookAction(() => me)
    await waitFor(() => expect(latest.action?.access.state).toBe("sign-in"))

    me = serviceAdvisor
    expect(await openAfterRereadBeforeRender(queryClient, latest)).toBe("sign-in")

    expect(await screen.findByRole("dialog", { name: "Book appointment" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Sign in to book" })).not.toBeInTheDocument()
  })

  it("opens nothing while /me has not answered yet", async () => {
    const { queryClient, latest } = renderBookAction(() => serviceAdvisor)
    await waitFor(() => expect(latest.action?.access.state).toBe("allowed"))

    act(() => {
      // The cached identity is gone (as a reset leaves it) and the press comes before the page has drawn that.
      queryClient.getQueryCache().find({ queryKey: currentUserQueryKey() })?.reset()
      latest.action?.open()
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
