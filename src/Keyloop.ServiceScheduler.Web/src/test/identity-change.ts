import { focusManager, type QueryClient } from "@tanstack/react-query"
import { act, fireEvent } from "@testing-library/react"
import { expect } from "vitest"

import type { AppointmentListItemResponse, WorkshopScheduleResponse } from "@/api/types.gen"
import { currentUserQueryKey } from "@/lib/session"

/**
 * What the pages' identity tests share (ARCHITECTURE §15): who is signed in changes while a view is open, and nothing read
 * or entered as the previous caller may stay on screen, in the cache or in a write's answer.
 */

/** The window losing and regaining focus: `/me`, and every stale read on screen, are read again. */
export function refocus() {
  act(() => {
    focusManager.setFocused(false)
    focusManager.setFocused(true)
  })
}

/**
 * Reads `/me` again (answered as the test's API now answers it) and presses `control` in the same task, before React has
 * drawn the new answer (TanStack tells the views on a zero timeout): the press that lands after the identity changed but
 * before the page shows it. Returns whether the control still looked usable (not `aria-disabled`) when it was pressed.
 */
export async function pressBeforeTheChangeIsDrawn(queryClient: QueryClient, control: HTMLElement): Promise<boolean> {
  let usable = false
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: currentUserQueryKey() })
    usable = control.isConnected && control.getAttribute("aria-disabled") !== "true"
    fireEvent.click(control)
  })
  return usable
}

/** A deferred answer: the request is held until the test lets it through. */
export function deferred<T>() {
  let release!: (value: T | Response) => void
  const promise = new Promise<T | Response>((resolve) => {
    release = resolve
  })
  return { promise, release: (value: T | Response) => act(() => release(value)) }
}

/** Everything the cache holds, as text: every query's data and every mutation's state (its variables, data and error). */
export function cachedText(queryClient: QueryClient): string {
  return JSON.stringify({
    queries: queryClient.getQueryCache().getAll().map((query) => query.state.data),
    mutations: queryClient.getMutationCache().getAll().map((mutation) => mutation.state),
  })
}

/** Every personal field of the Interim Service booking (Sophie Turner), as its schedule row and its record show them to a role. */
export const interimPersonalFields = [
  "Sophie Turner",
  "sophie.turner@example.com",
  "+44 7700 900105",
  "JTDKN3DU0A0123460",
  "RF20 BCJ",
  "Customer waiting in the lounge.",
  "Toyota Prius",
]

export function expectNothingPersonal(text: string | null | undefined, where: string) {
  for (const field of interimPersonalFields) expect(text ?? "", `${field} in ${where}`).not.toContain(field)
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")

/** A range read's appointment as the API answers a caller without a role: initials, the VIN's last six, the plate masked. */
export function maskedItem(item: AppointmentListItemResponse): AppointmentListItemResponse {
  return { ...item, customerName: initials(item.customerName), vin: `***********${item.vin.slice(-6)}`, registration: "*******" }
}

/** A day's schedule as the API answers a caller without a role. */
export function maskedSchedule(schedule: WorkshopScheduleResponse): WorkshopScheduleResponse {
  return {
    ...schedule,
    bays: schedule.bays.map((bay) => ({
      ...bay,
      appointments: bay.appointments.map((appointment) => ({
        ...appointment,
        customerName: initials(appointment.customerName),
        vin: `***********${appointment.vin.slice(-6)}`,
        registration: "*******",
      })),
    })),
  }
}

/**
 * Records the text of every open dialog each time the page changes, until `stop()` returns them. A MutationObserver's
 * callback runs once the change has been made and before the browser could paint it, so the record holds every state a
 * dialog was ever drawn in, not only the last one: a sheet that showed a booking to the next caller for one render is in it.
 */
export function recordDialogs(): { stop: () => string[] } {
  const seen: string[] = []
  const record = () => {
    for (const dialog of document.querySelectorAll('[role="dialog"]')) seen.push(dialog.textContent ?? "")
  }
  const observer = new MutationObserver(record)
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })
  return {
    stop: () => {
      record()
      observer.disconnect()
      return seen
    },
  }
}
