import { type RefObject, useEffect, useRef } from "react"

/**
 * Focus hand-offs for a control that takes itself away (Codex check of Task 30b, UI_DESIGN 11.24): a focused element
 * removed from the page drops focus to the page, and one removed from a sheet or dialog sends it to the popup itself
 * (Base UI restores it there on the next frame), so focus moves on before the control goes.
 */

/**
 * "Show older ..." for a list of focusable `article`s (tabIndex -1): when the last page takes the button away, focus goes
 * to the first article it loaded. The page can arrive before or after React draws it, so the hand-off is tried at once and
 * again after each commit until it lands.
 */
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

/**
 * After a successful Try again, the alert holding it is replaced by what loaded: `arm` when the retry is pressed, and the
 * target is focused once it is drawn (tried after each commit until it exists).
 */
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

/**
 * Where focus goes once a technician's level is confirmed, so the button (and the review note, with the last level) can go:
 * the next level to review, else that technician's row actions, else (a search or filter hides the row) the list's search
 * field, else Add technician. All by record id: a rename (and the re-sort it brings) can come between; rows are keyed by
 * record, so the row actions keep their element.
 */
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
