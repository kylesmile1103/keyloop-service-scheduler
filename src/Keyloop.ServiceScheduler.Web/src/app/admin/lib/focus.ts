import { type RefObject, useEffect, useRef } from "react"

/** Focus management helpers for controls that unmount on completion (pagination, retry, and HV confirmation). */

/** Moves focus to the first newly loaded article when the final page removes the "Show older" button. */
export function useLastPageFocus(container: RefObject<HTMLElement | null>) {
  const from = useRef<number | null>(null)
  const land = () => {
    const index = from.current
    const article = index === null ? undefined : container.current?.querySelectorAll<HTMLElement>("article")[index]
    if (!article) return
    from.current = null
    article.focus()
  }
  useEffect(land)
  return async (loaded: number, fetchNext: () => Promise<{ hasNextPage: boolean }>) => {
    const result = await fetchNext()
    if (result.hasNextPage) return
    from.current = loaded
    land()
  }
}

/** Moves focus to a target element after a retry replaces the error alert. */
export function useFocusAfterRetry(target: () => HTMLElement | null | undefined) {
  const armed = useRef(false)
  useEffect(() => {
    if (!armed.current) return
    const element = target()
    if (!element) return
    armed.current = false
    element.focus()
  })
  return () => {
    armed.current = true
  }
}

/** The element with exactly this accessible label, if any (names may hold quotes, so no selector is built from them). */
export function byLabel(label: string, scope: ParentNode = document): HTMLElement | null {
  return [...scope.querySelectorAll<HTMLElement>("[aria-label]")].find((element) => element.getAttribute("aria-label") === label) ?? null
}

/** A technician's Confirm button in the HV review note, by record (another Admin may rename them meanwhile). */
export function confirmButtonFor(id: string): HTMLElement | null {
  return byLabel("HV levels to review")?.querySelector<HTMLElement>(`button[data-record-id="${id}"]`) ?? null
}

/** Resolves the next focus target after confirming a technician's HV level. */
export function pastConfirmed(id: string): HTMLElement | null {
  const note = byLabel("HV levels to review")
  const next = note ? [...note.querySelectorAll<HTMLElement>("button[data-record-id]")].find((button) => button.dataset.recordId !== id) : undefined
  return (
    next ??
    document.querySelector<HTMLElement>(`[data-row-actions][data-record-id="${id}"]`) ??
    document.querySelector<HTMLElement>('input[type="search"]') ??
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Add technician") ??
    null
  )
}

/** Restores focus if a list refetch after HV confirmation unmounts the previously focused element. */
export function useRefocusAfterReread(fetching: boolean) {
  const pending = useRef<{ id: string; sawFetch: boolean } | null>(null)
  useEffect(() => {
    const armed = pending.current
    if (!armed) return
    if (fetching) armed.sawFetch = true
    const active = document.activeElement
    if (!active || active === document.body || !active.isConnected) pastConfirmed(armed.id)?.focus()
    if (armed.sawFetch && !fetching) pending.current = null
  })
  return (id: string) => {
    pending.current = { id, sawFetch: false }
  }
}
