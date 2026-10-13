import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { CurrentUserResponse, ReturningCustomerResponse } from "@/api/types.gen"
import { currentUserQueryKey } from "@/lib/session"
import { mockBoardApi } from "@/test/board-api"
import { reading } from "@/test/dealerships"
import { admin, serviceAdvisor, viewer } from "@/test/identities"
import { cachedText, deferred, recordDialogs, refocus } from "@/test/identity-change"
import { problemResponse } from "@/test/mock-api"
import { phoneViewport, renderBoard } from "@/test/render-board"
import { adaClio, graceGolf, graceYaris } from "@/test/returning"
import { vehicleAwareOff, vehicleAwareOn } from "@/test/vehicle"

import { LOOKUP_DEBOUNCE_MS } from "./lib/returning-customer"

// Returning-customer search on step 2: searches past bookings by registration, email, phone, or name to prefill customer and vehicle fields.

beforeAll(async () => {
  await import("@/app/dispatch/page")
})

beforeEach(() => {
  // Tuesday 2026-10-13, 09:30 in Reading (BST). Only Date is faked; timers stay real for the UI and the debounce.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-13T08:30:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

const board = `/dispatch?dealership=${reading.id}`
const pause = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))

const lookups = (requests: readonly Request[]) =>
  requests.filter((request) => request.method === "POST" && new URL(request.url).pathname.endsWith("/customer-lookups"))
const queryOf = async (request: Request) => ((await request.clone().json()) as { query: string }).query
const resolves = (requests: readonly Request[]) => requests.filter((request) => new URL(request.url).pathname.endsWith("/vehicle-profiles/resolve"))

/** The booking dialog on step 2 (Interim Service at 10:15), where the search is. */
async function stepTwo() {
  fireEvent.click(await screen.findByRole("button", { name: "Book appointment" }))
  return throughStepOne(await screen.findByRole("dialog", { name: "Book appointment" }))
}

async function throughStepOne(scope: HTMLElement) {
  fireEvent.click(await within(scope).findByRole("combobox", { name: "Service" }))
  const option = await screen.findByRole("option", { name: /^Interim Service/ })
  fireEvent.pointerDown(option, { pointerType: "mouse" })
  fireEvent.click(option)
  const chip = await within(scope).findByRole("radio", { name: /^10:15/ })
  fireEvent.click(chip)
  await waitFor(() => expect(chip).toHaveAttribute("aria-checked", "true"))
  fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
  await within(scope).findByRole("heading", { name: "Customer and vehicle" })
  return scope
}

const searchBox = (scope: HTMLElement) => within(scope).getByRole("combobox", { name: "Returning customer" })
const type = (scope: HTMLElement, text: string) => fireEvent.change(searchBox(scope), { target: { value: text } })
const field = (scope: HTMLElement, label: string) => within(scope).getByRole("textbox", { name: label }) as HTMLInputElement
/** What the search announces politely (its visually hidden status). */
const announced = (scope: HTMLElement) => scope.querySelector("[data-slot=returning-customer] [role=status]")

const filledFromGrace = {
  Name: "Grace Hopper",
  Email: "grace.hopper@example.com",
  Phone: "+44 7700 900123",
  VIN: "WVWZZZ1KZAW654321",
  Registration: "RK22 ABC",
  Make: "Volkswagen",
  Model: "Golf",
}

describe("searching", () => {
  it("waits for two characters and a pause in typing, then sends one search in the request's body", async () => {
    const api = mockBoardApi({ me: () => admin, customerLookup: () => [graceGolf] })
    renderBoard(board)
    const scope = await stepTwo()
    const box = searchBox(scope)
    expect(box).toHaveAccessibleDescription("Search earlier bookings by registration, email, phone or name.")
    expect(box).toHaveAttribute("aria-expanded", "false")

    type(scope, "R")
    await pause(LOOKUP_DEBOUNCE_MS + 150)
    expect(lookups(api.requests)).toHaveLength(0)

    // Typed quickly: nothing goes until the typing pauses, and then only the last.
    type(scope, "RK")
    type(scope, "RK2")
    type(scope, "RK22 ")
    await pause(LOOKUP_DEBOUNCE_MS - 100)
    expect(lookups(api.requests)).toHaveLength(0)
    expect(within(scope).getByText("Searching earlier bookings…")).toBeInTheDocument()
    await waitFor(() => expect(lookups(api.requests)).toHaveLength(1))
    const [request] = lookups(api.requests)
    expect(new URL(request.url).pathname).toBe(`/api/v1/dealerships/${reading.id}/customer-lookups`)
    expect(new URL(request.url).search).toBe("")
    expect(await queryOf(request)).toBe("RK22")

    expect(await within(scope).findByRole("listbox", { name: "Earlier bookings" })).toBeInTheDocument()
    expect(box).toHaveAttribute("aria-expanded", "true")
    // A trailing space is the same search: nothing more is sent.
    type(scope, "RK22")
    await pause(LOOKUP_DEBOUNCE_MS + 150)
    expect(lookups(api.requests)).toHaveLength(1)
  })

  it("shows each match's name, plate, email (or phone), make and model, and its last visit in the dealership's zone", async () => {
    // Ada's last visit began at 00:30 on 5 October in Reading, still the 4th in UTC; a future booking is not a visit yet.
    const ahead: ReturningCustomerResponse = { ...graceYaris, lastVisitUtc: "2026-10-20T09:00:00Z", visits: 2 }
    mockBoardApi({ me: () => admin, customerLookup: () => [ahead, graceGolf, adaClio] })
    renderBoard(board)
    const scope = await stepTwo()
    type(scope, "rk")

    const listbox = await within(scope).findByRole("listbox", { name: "Earlier bookings" })
    const [first, second, third] = within(listbox).getAllByRole("option")
    expect(second).toHaveAccessibleName(
      "Grace Hopper, registration RK22 ABC, Volkswagen Golf, grace.hopper@example.com, Last visit 12 Oct 2026, 3 visits"
    )
    expect(second).toHaveTextContent("Grace Hopper")
    expect(within(second).getByText("RK22 ABC", { exact: false })).toHaveClass("plate-chip")
    expect(second).toHaveTextContent("grace.hopper@example.com")
    expect(second).toHaveTextContent("Volkswagen Golf")
    expect(second).toHaveTextContent("Last visit 12 Oct 2026 · 3 visits")
    // No email: the phone instead. The date is Reading's.
    expect(third).toHaveTextContent("+44 7700 900456")
    expect(third).toHaveTextContent("Last visit 5 Oct 2026 · 2 visits")
    expect(first).toHaveTextContent("Booked for 20 Oct 2026 · 2 visits")
    expect(announced(scope)).toHaveTextContent("3 matches, latest first.")
  })

  it("never shows an answer overtaken by a newer search, and cancels its request", async () => {
    const slow = deferred<ReturningCustomerResponse[]>()
    const api = mockBoardApi({ me: () => admin, customerLookup: (_, body) => (body.query === "Gra" ? slow.promise : [graceGolf]) })
    renderBoard(board)
    const scope = await stepTwo()
    const drawn = recordDialogs()

    type(scope, "Gra")
    await waitFor(() => expect(lookups(api.requests)).toHaveLength(1))
    type(scope, "Grace")
    await waitFor(() => expect(lookups(api.requests)).toHaveLength(2))
    expect(lookups(api.requests)[0].signal.aborted).toBe(true)
    expect(await within(scope).findByRole("option", { name: /^Grace Hopper/ })).toBeInTheDocument()

    slow.release([adaClio])
    await pause(100)
    expect(drawn.stop().some((text) => text.includes("Ada Lovelace"))).toBe(false)
    expect(within(scope).getAllByRole("option")).toHaveLength(1)
  })

  it("takes the matches away as soon as the box no longer says what they were found for", async () => {
    const api = mockBoardApi({ me: () => admin, customerLookup: (_, body) => (body.query === "Ada" ? [adaClio] : [graceGolf]) })
    renderBoard(board)
    const scope = await stepTwo()
    type(scope, "Ada")
    expect(await within(scope).findByRole("option", { name: /^Ada Lovelace/ })).toBeInTheDocument()

    type(scope, "Grace")
    expect(within(scope).queryByRole("option", { name: /^Ada Lovelace/ })).not.toBeInTheDocument()
    expect(within(scope).getByText("Searching earlier bookings…")).toBeInTheDocument()
    expect(await within(scope).findByRole("option", { name: /^Grace Hopper/ })).toBeInTheDocument()
    expect(lookups(api.requests)).toHaveLength(2)

    type(scope, "G")
    expect(within(scope).queryByRole("listbox")).not.toBeInTheDocument()
    expect(searchBox(scope)).toHaveAccessibleDescription("Search earlier bookings by registration, email, phone or name.")
  })

  it("says when nothing matches, and announces it", async () => {
    mockBoardApi({ me: () => admin, customerLookup: () => [] })
    renderBoard(board)
    const scope = await stepTwo()
    type(scope, "ZZ99 ZZZ")

    await waitFor(() => expect(searchBox(scope)).toHaveAccessibleDescription("No earlier bookings match. Enter the details below."))
    expect(within(scope).queryByRole("listbox")).not.toBeInTheDocument()
    expect(searchBox(scope)).toHaveAttribute("aria-expanded", "false")
    expect(announced(scope)).toHaveTextContent("No earlier bookings match.")
  })
})

describe("choosing from the keyboard", () => {
  it("moves through the matches with the arrows, closes them with Escape and chooses with Enter", async () => {
    const api = mockBoardApi({ me: () => admin, customerLookup: () => [graceGolf, graceYaris] })
    renderBoard(board)
    const scope = await stepTwo()
    const box = searchBox(scope)
    box.focus()
    type(scope, "Grace")
    const listbox = await within(scope).findByRole("listbox", { name: "Earlier bookings" })
    const [golf, yaris] = within(listbox).getAllByRole("option")
    expect(box).not.toHaveAttribute("aria-activedescendant")

    fireEvent.keyDown(box, { key: "ArrowDown" })
    expect(box).toHaveAttribute("aria-activedescendant", golf.id)
    expect(golf).toHaveAttribute("aria-selected", "true")
    fireEvent.keyDown(box, { key: "ArrowDown" })
    expect(box).toHaveAttribute("aria-activedescendant", yaris.id)
    fireEvent.keyDown(box, { key: "ArrowDown" })
    expect(box).toHaveAttribute("aria-activedescendant", golf.id)
    fireEvent.keyDown(box, { key: "ArrowUp" })
    expect(box).toHaveAttribute("aria-activedescendant", yaris.id)
    expect(golf).toHaveAttribute("aria-selected", "false")

    // Escape closes the matches only: the dialog and the search stay.
    fireEvent.keyDown(box, { key: "Escape" })
    expect(within(scope).queryByRole("listbox")).not.toBeInTheDocument()
    expect(box).toHaveAttribute("aria-expanded", "false")
    expect(box).toHaveValue("Grace")
    expect(screen.getByRole("dialog", { name: "Book appointment" })).toBeInTheDocument()

    // Up opens them on the last; Enter chooses it, and is never the booking form's submit.
    fireEvent.keyDown(box, { key: "ArrowUp" })
    expect(within(scope).getByRole("option", { name: /RK19 GHY/ })).toHaveAttribute("aria-selected", "true")
    expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(false)

    expect(field(scope, "Registration")).toHaveValue("RK19 GHY")
    expect(field(scope, "Model")).toHaveValue("Yaris")
    expect(box).toHaveValue("")
    expect(within(scope).queryByRole("listbox")).not.toBeInTheDocument()
    const note = within(scope).getByText(/^Details from the booking on/).closest("[data-slot=returning-note]")
    await waitFor(() => expect(note).toHaveFocus())
    expect(note).toHaveTextContent("Details from the booking on 28 Aug 2026. Check they are still right.")
    expect(api.requests.filter((request) => request.method === "POST" && new URL(request.url).pathname.endsWith("/appointments"))).toHaveLength(0)
  })

  it("clears the search on Escape when no matches show, and leaves the next Escape to close the dialog", async () => {
    mockBoardApi({ me: () => admin, customerLookup: () => [] })
    renderBoard(board)
    const scope = await stepTwo()
    const box = searchBox(scope)
    box.focus()
    type(scope, "Nobody")
    await waitFor(() => expect(announced(scope)).toHaveTextContent(/^No earlier bookings match/))

    fireEvent.keyDown(box, { key: "Escape" })
    expect(box).toHaveValue("")
    expect(screen.getByRole("dialog", { name: "Book appointment" })).toBeInTheDocument()
    fireEvent.keyDown(box, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Book appointment" })).not.toBeInTheDocument())
  })

  it("searches at once on Enter, without waiting for the pause", async () => {
    const api = mockBoardApi({ me: () => admin, customerLookup: () => [graceGolf] })
    renderBoard(board)
    const scope = await stepTwo()
    type(scope, "grace.hopper@")
    // Cancelled: Enter in the search never submits the booking.
    expect(fireEvent.keyDown(searchBox(scope), { key: "Enter" })).toBe(false)
    expect(lookups(api.requests)).toHaveLength(0)
    await waitFor(() => expect(lookups(api.requests)).toHaveLength(1), { timeout: LOOKUP_DEBOUNCE_MS - 100 })
    await pause(LOOKUP_DEBOUNCE_MS + 100)
    expect(lookups(api.requests)).toHaveLength(1)
  })
})

describe("filling in the booking", () => {
  it("fills the customer and vehicle with a click, each still editable, and Clear empties only what it filled", async () => {
    mockBoardApi({ me: () => admin, customerLookup: () => [graceGolf] })
    renderBoard(board)
    const scope = await stepTwo()
    fireEvent.change(within(scope).getByRole("textbox", { name: "Notes for the workshop" }), { target: { value: "Waiting in the lounge" } })
    type(scope, "RK22")
    const option = await within(scope).findByRole("option", { name: /^Grace Hopper/ })
    fireEvent.mouseDown(option)
    fireEvent.click(option)

    for (const [label, value] of Object.entries(filledFromGrace)) expect(field(scope, label)).toHaveValue(value)
    expect(within(scope).getByText(/^Details from the booking on/).closest("[data-slot=returning-note]")).toHaveTextContent(
      "Details from the booking on 12 Oct 2026. Check they are still right."
    )

    // The phone was changed since: it is the person's now, and Clear keeps it.
    fireEvent.change(field(scope, "Phone"), { target: { value: "+44 7700 900999" } })
    fireEvent.click(within(scope).getByRole("button", { name: "Clear the details from that booking" }))

    for (const label of ["Name", "Email", "VIN", "Registration", "Make", "Model"]) expect(field(scope, label)).toHaveValue("")
    expect(field(scope, "Phone")).toHaveValue("+44 7700 900999")
    expect(within(scope).getByRole("textbox", { name: "Notes for the workshop" })).toHaveValue("Waiting in the lounge")
    expect(within(scope).queryByText(/^Details from the booking on/)).not.toBeInTheDocument()
    await waitFor(() => expect(searchBox(scope)).toHaveFocus())
  })

  it("books with the filled details, as typed ones would", async () => {
    const api = mockBoardApi({ me: () => admin, customerLookup: () => [graceGolf] })
    renderBoard(board)
    const scope = await stepTwo()
    type(scope, "Grace")
    fireEvent.click(await within(scope).findByRole("option", { name: /^Grace Hopper/ }))
    fireEvent.click(within(scope).getByRole("button", { name: "Book" }))

    await waitFor(() =>
      expect(api.requests.filter((request) => request.method === "POST" && new URL(request.url).pathname.endsWith("/appointments"))).toHaveLength(1)
    )
    const booking = api.requests.find((request) => request.method === "POST" && new URL(request.url).pathname.endsWith("/appointments"))!
    const body = await booking.clone().json()
    expect(body.customer).toEqual({ name: "Grace Hopper", email: "grace.hopper@example.com", phone: "+44 7700 900123" })
    expect(body.vehicle).toEqual({ vin: "WVWZZZ1KZAW654321", registration: "RK22 ABC", make: "Volkswagen", model: "Golf" })
  })

  it("looks the filled VIN up with vehicle-aware requirements on, as Look up does", async () => {
    const api = mockBoardApi({ me: () => admin, features: () => vehicleAwareOn, customerLookup: () => [graceGolf] })
    renderBoard(board)
    const scope = await stepTwo()
    type(scope, "Grace")
    fireEvent.click(await within(scope).findByRole("option", { name: /^Grace Hopper/ }))

    await waitFor(() => expect(resolves(api.requests)).toHaveLength(1))
    expect(await resolves(api.requests)[0].clone().json()).toEqual({ vin: "WVWZZZ1KZAW654321" })
    expect(await within(scope).findByText("VOLKSWAGEN")).toBeInTheDocument()
  })

  it("leaves the VIN alone with vehicle-aware requirements off", async () => {
    const api = mockBoardApi({ me: () => admin, features: () => vehicleAwareOff, customerLookup: () => [graceGolf] })
    renderBoard(board)
    const scope = await stepTwo()
    type(scope, "Grace")
    fireEvent.click(await within(scope).findByRole("option", { name: /^Grace Hopper/ }))
    expect(field(scope, "VIN")).toHaveValue("WVWZZZ1KZAW654321")
    await pause(100)
    expect(resolves(api.requests)).toHaveLength(0)
  })

  it("keeps the note across the steps, and fills the phone's full-screen sheet the same way", async () => {
    phoneViewport()
    mockBoardApi({ me: () => admin, customerLookup: () => [graceGolf] })
    renderBoard(board)
    fireEvent.click(await screen.findByRole("button", { name: "Book appointment" }))
    const scope = await screen.findByRole("dialog", { name: "Book appointment" })
    expect(scope).toHaveAttribute("data-side", "bottom")
    fireEvent.click(await within(scope).findByRole("combobox", { name: "Service" }))
    const option = await screen.findByRole("option", { name: /^Interim Service/ })
    fireEvent.pointerDown(option, { pointerType: "mouse" })
    fireEvent.click(option)
    fireEvent.click(await within(scope).findByRole("radio", { name: /^10:15/ }))
    fireEvent.click(within(scope).getByRole("button", { name: "Next" }))
    await within(scope).findByRole("heading", { name: "Customer and vehicle" })

    type(scope, "RK22")
    fireEvent.click(await within(scope).findByRole("option", { name: /^Grace Hopper/ }))
    expect(field(scope, "Name")).toHaveValue("Grace Hopper")
    fireEvent.click(within(scope).getByRole("button", { name: "Back" }))
    fireEvent.click(await within(scope).findByRole("button", { name: "Next" }))
    expect(await within(scope).findByText(/^Details from the booking on/)).toBeInTheDocument()
    expect(field(scope, "Name")).toHaveValue("Grace Hopper")
  })
})

describe("when a search fails", () => {
  it("shows the app's problem alert, and Try again searches again", async () => {
    let fail = true
    const api = mockBoardApi({
      me: () => admin,
      customerLookup: () =>
        fail
          ? problemResponse(500, { type: "about:blank", title: "Internal Server Error", status: 500, traceId: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" })
          : [graceGolf],
    })
    renderBoard(board)
    const scope = await stepTwo()
    type(scope, "Grace")

    const alert = await within(scope).findByRole("alert")
    expect(alert).toHaveTextContent("Couldn’t search earlier bookings")
    expect(alert).toHaveTextContent("4bf92f3577b34da6a3ce929d0e0e4736")
    expect(alert).toHaveTextContent("You can still enter the details below.")
    await pause(LOOKUP_DEBOUNCE_MS + 100)
    expect(lookups(api.requests)).toHaveLength(1)

    fail = false
    const retry = within(alert).getByRole("button", { name: "Try again" })
    retry.focus()
    fireEvent.click(retry)
    expect(await within(scope).findByRole("option", { name: /^Grace Hopper/ })).toBeInTheDocument()
    expect(lookups(api.requests)).toHaveLength(2)
    expect(within(scope).queryByRole("alert")).not.toBeInTheDocument()
    await waitFor(() => expect(searchBox(scope)).toHaveFocus())
  })

  it("asks to wait out a rate limit and never sends the same search again on its own", async () => {
    let limited = true
    const api = mockBoardApi({
      me: () => admin,
      customerLookup: () =>
        limited
          ? problemResponse(429, {
              type: "https://api.keyloop.example/problems/rate-limited",
              title: "Too many requests",
              status: 429,
              detail: "Try again in 1 seconds.",
              retryAfterSeconds: 1,
            })
          : [graceGolf],
    })
    renderBoard(board)
    const scope = await stepTwo()
    type(scope, "Grace")

    const alert = await within(scope).findByRole("alert")
    expect(alert).toHaveTextContent("Too many requests - try again in 1 s")
    expect(within(alert).getByRole("button", { name: "Try again" })).toHaveAttribute("aria-disabled", "true")
    limited = false
    await waitFor(() => expect(alert).toHaveTextContent("Too many requests - try again now"), { timeout: 2500 })
    await pause(LOOKUP_DEBOUNCE_MS + 300)
    expect(lookups(api.requests)).toHaveLength(1)

    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }))
    expect(await within(scope).findByRole("option", { name: /^Grace Hopper/ })).toBeInTheDocument()
    expect(lookups(api.requests)).toHaveLength(2)
  })
})

describe("privacy", () => {
  it("drops the matches when who is signed in changes, even between two roles of the same account", async () => {
    let me: CurrentUserResponse = admin
    mockBoardApi({ me: () => me, customerLookup: () => [graceGolf] })
    const { queryClient } = renderBoard(board)
    const scope = await stepTwo()
    type(scope, "Grace")
    await within(scope).findByRole("option", { name: /^Grace Hopper/ })

    // The same person, now a Service advisor: the booking being entered stays, the search starts empty.
    me = { ...admin, roles: ["ServiceAdvisor"] }
    refocus()
    await waitFor(() => expect(queryClient.getQueryData(currentUserQueryKey())).toEqual(me))
    await waitFor(() => expect(within(scope).queryByRole("listbox")).not.toBeInTheDocument())
    expect(searchBox(scope)).toHaveValue("")
    expect(cachedText(queryClient)).not.toContain("grace.hopper@example.com")
    expect(cachedText(queryClient)).not.toContain("Grace")
  })

  it("drops the matches with the booking when another account signs in", async () => {
    let me: CurrentUserResponse = admin
    mockBoardApi({ me: () => me, customerLookup: () => [graceGolf] })
    const { queryClient } = renderBoard(board)
    const scope = await stepTwo()
    type(scope, "Grace")
    fireEvent.click(await within(scope).findByRole("option", { name: /^Grace Hopper/ }))
    type(scope, "Grace")
    await within(scope).findByRole("option", { name: /^Grace Hopper/ })

    me = serviceAdvisor
    refocus()
    await waitFor(() => expect(queryClient.getQueryData(currentUserQueryKey())).toEqual(serviceAdvisor))
    await within(scope).findByText(/The session changed: another account is signed in/)
    expect(within(scope).queryByRole("option")).not.toBeInTheDocument()
    expect(within(scope).queryByText(/^Details from the booking on/)).not.toBeInTheDocument()
    expect(cachedText(queryClient)).not.toContain("grace.hopper@example.com")
  })

  it("is unavailable, and says why, once the account may not book", async () => {
    let me: CurrentUserResponse = admin
    const api = mockBoardApi({ me: () => me, customerLookup: () => [graceGolf] })
    const { queryClient } = renderBoard(board)
    const scope = await stepTwo()

    me = viewer
    refocus()
    await waitFor(() => expect(queryClient.getQueryData(currentUserQueryKey())).toEqual(viewer))
    await within(scope).findByText(/The session changed: this account can’t book any more/)
    // The flow started again on step 1 for the discarded booking; on step 2 the search is unavailable, with the reason.
    await throughStepOne(scope)
    const box = searchBox(scope)
    expect(box).toBeDisabled()
    expect(box).toHaveAccessibleDescription(/this account can’t book any more/)
    expect(lookups(api.requests)).toHaveLength(0)
  })

  it("keeps the search out of every address, the console and the cache once the dialog closes", async () => {
    const consoleCalls = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method))
    const api = mockBoardApi({ me: () => admin, customerLookup: () => [graceGolf] })
    const { queryClient } = renderBoard(board)
    const scope = await stepTwo()
    type(scope, "RK22 ABC")
    await within(scope).findByRole("option", { name: /^Grace Hopper/ })
    expect(cachedText(queryClient)).toContain("grace.hopper@example.com")

    fireEvent.click(within(scope).getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Book appointment" })).not.toBeInTheDocument())
    await pause(50)

    expect(cachedText(queryClient)).not.toContain("grace.hopper@example.com")
    expect(cachedText(queryClient)).not.toContain("RK22 ABC")
    for (const request of api.requests) {
      const address = decodeURIComponent(request.url).toUpperCase().replaceAll(/\s/g, "")
      expect(address).not.toContain("RK22ABC")
    }
    for (const spy of consoleCalls) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain("RK22 ABC")
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (let index = 0; index < storage.length; index++) expect(storage.getItem(storage.key(index)!)).not.toContain("RK22 ABC")
    }
  })
})
