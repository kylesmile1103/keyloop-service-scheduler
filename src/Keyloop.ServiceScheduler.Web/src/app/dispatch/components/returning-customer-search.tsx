import { History, LoaderCircle, Search } from "lucide-react"
import { type KeyboardEvent, useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from "react"

import { findReturningCustomersMutation } from "@/api/@tanstack/react-query.gen"
import type { ReturningCustomerResponse } from "@/api/types.gen"
import { ProblemAlert } from "@/components/problem-alert"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useCountdown } from "@/hooks/use-countdown"
import { useMutationFailure } from "@/hooks/use-mutation-failure"
import { useWriteMutation } from "@/hooks/use-write-mutation"
import { authRefusalTitle, failureStatus, parseProblem } from "@/lib/problem-details"

import {
  bookingDay,
  contactOf,
  LOOKUP_DEBOUNCE_MS,
  LOOKUP_MAX_LENGTH,
  lookupTerm,
  matchesLine,
  matchLabel,
  vehicleOf,
  visitLine,
} from "../lib/returning-customer"

type LookupVariables = Parameters<NonNullable<ReturnType<typeof findReturningCustomersMutation>["mutationFn"]>>[0]

/** The search's mutation key: a fixed name, never the search itself. */
const LOOKUP_MUTATION_KEY = ["findReturningCustomers"]

export interface ReturningCustomerSearchProps {
  dealershipId: string
  /** The dealership's IANA zone: a match's last visit is a date on its calendar. */
  timeZone: string
  /** Today on the dealership's calendar (`yyyy-MM-dd`), to tell a visit made from one still to come. */
  today: string
  /** The id of the note saying why the search is unavailable (the identity changed to one that may not book). */
  blockedBy?: string
  /** The most recent booking's start (`lastVisitUtc`) of the match the fields were filled from, while the note shows. */
  filledFrom: string | null
  onChoose: (match: ReturningCustomerResponse) => void
  /** The note's Clear: empty what the choice filled in. */
  onClear: () => void
}

/**
 * "Returning customer" at the top of step 2's customer section (Task 39b, UI_DESIGN 11.14): staff type a registration,
 * email, phone or name and choose an earlier booking of this dealership, which fills in the customer and the vehicle.
 *
 * An editable combobox with a list popup (the WAI-ARIA combobox pattern: list autocomplete, manual selection,
 * `aria-activedescendant`): Down and Up move through the matches (opening them), Enter chooses one, Escape closes them and
 * then clears the search, a pointer chooses one with a click; the count is announced politely. Searches go from two
 * characters, once typing pauses (`LOOKUP_DEBOUNCE_MS`); only the answer for what is in the box now is ever shown, and a
 * search overtaken by another is cancelled.
 *
 * What is typed and what comes back are personal data. The search goes in the request's body only (never a URL, a query
 * key, the console or a span), as a write bound to the account the dialog was drawn for (`useWriteMutation`: an answer
 * that arrives after who is signed in changed is thrown away); the answer lives in this component's mutation, dropped as
 * soon as nothing shows it (`gcTime` 0), and by the identity change's cache clearing. The dialog keys this component by
 * the identity, so any change of caller starts it empty.
 */
export function ReturningCustomerSearch({ dealershipId, timeZone, today, blockedBy, filledFrom, onChoose, onClear }: ReturningCustomerSearchProps) {
  const id = useId()
  const ids = { input: `${id}-input`, listbox: `${id}-listbox`, line: `${id}-line`, note: `${id}-note` }
  const optionId = (index: number) => `${id}-option-${index}`
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const noteRef = useRef<HTMLDivElement>(null)
  // What cancels the search in flight (by its variables, as the request leaves), and where focus goes once the view has
  // drawn: the note after a choice, the box after Clear, the box once a Try again is answered with matches.
  const box = useRef({
    controller: null as AbortController | null,
    signals: new WeakMap<object, AbortSignal>(),
    focus: null as "note" | "input" | "answered" | null,
  })

  const [typed, setTyped] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [waiting, startWaiting] = useCountdown()
  // The last rate limit's answer, for its trace id while its wait runs (whatever is typed meanwhile).
  const [limit, setLimit] = useState<unknown>(null)
  // The search Try again sent again: its failure stays on screen, its button busy and focused, until the answer.
  const [retried, setRetried] = useState<string | null>(null)

  const generated = findReturningCustomersMutation()
  const lookup = useWriteMutation({
    mutationKey: LOOKUP_MUTATION_KEY,
    // Personal data: gone from the mutation cache as soon as no view holds it (the default keeps it five minutes).
    gcTime: 0,
    mutationFn: (variables: LookupVariables, write, context) =>
      generated.mutationFn!({ ...variables, signal: box.current.signals.get(variables), fetch: write.fetch() }, context),
    onError: (error) => {
      if (failureStatus(error) !== 429) return
      const problem = parseProblem(error)
      setLimit(error)
      startWaiting(Math.max(1, Math.ceil(Number(problem?.retryAfterSeconds ?? 1))))
    },
  })
  const failure = useMutationFailure(lookup)

  const term = lookupTerm(typed)
  // The search the view holds now (TanStack's observer follows only the latest one sent, so an overtaken answer never
  // reaches it), and whether it is for what is in the box.
  const sent = lookup.variables?.body.query ?? null
  const current = term !== null && sent === term
  const matches = current && lookup.isSuccess ? lookup.data : undefined
  const failed = current && failure !== null && (lookup.isError || retried === term) ? failure : null
  const limited = waiting > 0 ? limit : failed !== null && failureStatus(failed) === 429 ? failed : null
  const searching = term !== null && !blockedBy && !limited && (current ? lookup.isPending && !failed : true)
  const shown = open && matches !== undefined && matches.length > 0

  // A new answer starts with nothing highlighted (React's pattern for state that follows a value).
  const [activeFor, setActiveFor] = useState(matches)
  if (activeFor !== matches) {
    setActiveFor(matches)
    setActive(-1)
  }

  /** Sends a search now: the one before it is cancelled, and its answer could not be shown anyway. */
  function search(query: string, retry = false) {
    if (blockedBy) return
    box.current.controller?.abort()
    const controller = new AbortController()
    const variables: LookupVariables = { path: { dealershipId }, body: { query } }
    box.current.signals.set(variables, controller.signal)
    box.current.controller = controller
    setRetried(retry ? query : null)
    lookup.mutate(variables)
  }

  /** Nothing to search for (the box emptied, a match chosen): the search in flight is cancelled and the answer dropped. */
  function forget() {
    box.current.controller?.abort()
    box.current.controller = null
    setRetried(null)
    lookup.reset()
  }

  // Once typing pauses. Never again on its own for the search already sent (a failure, a rate limit), only for a new one.
  const searchLater = useEffectEvent((query: string) => search(query))
  useEffect(() => {
    if (term === null || term === sent || blockedBy || waiting > 0) return
    const timer = setTimeout(() => searchLater(term), LOOKUP_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term, sent, blockedBy, waiting])

  // Leaving the dialog's step (or the dialog) cancels a search still out.
  useEffect(() => {
    const state = box.current
    return () => state.controller?.abort()
  }, [])

  // The matches open in view: the dialog's body scrolls just enough to show the whole list (on a phone it would otherwise
  // run under the sticky footer), which keeps the box above it in view too.
  useLayoutEffect(() => {
    if (shown) listRef.current?.scrollIntoView?.({ block: "nearest" })
  }, [shown, matches])

  // The highlighted match stays in view as the arrows move through a list longer than its box.
  useEffect(() => {
    if (shown && active >= 0) document.getElementById(optionId(active))?.scrollIntoView?.({ block: "nearest" })
  })

  // After a choice focus goes to the note (on a phone that also puts the keyboard away, so the filled fields show); after
  // Clear back to the search; after a Try again, to the search once the answer took the alert and its button away. In the
  // commit, before the dialog's focus guard would put the focus a removed control held on the dialog itself.
  useLayoutEffect(() => {
    const want = box.current.focus
    if (want === "note" && noteRef.current) {
      box.current.focus = null
      noteRef.current.focus()
    } else if (want === "input") {
      box.current.focus = null
      inputRef.current?.focus()
    } else if (want === "answered" && !lookup.isPending) {
      box.current.focus = null
      if (!failed && !limited) inputRef.current?.focus()
    }
  })

  function change(next: string) {
    setTyped(next)
    setOpen(true)
    setActive(-1)
    if (lookupTerm(next) === null) forget()
  }

  function choose(match: ReturningCustomerResponse) {
    setTyped("")
    setOpen(false)
    setActive(-1)
    forget()
    box.current.focus = "note"
    onChoose(match)
  }

  function clear() {
    box.current.focus = "input"
    onClear()
  }

  function retry() {
    if (term === null || waiting > 0) return
    box.current.focus = "answered"
    search(term, true)
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    const count = matches?.length ?? 0
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        if (count === 0) return
        event.preventDefault()
        const down = event.key === "ArrowDown"
        if (!shown) {
          setOpen(true)
          setActive(down ? 0 : count - 1)
        } else setActive(active < 0 ? (down ? 0 : count - 1) : (active + (down ? 1 : count - 1)) % count)
        return
      }
      case "Enter":
        // Never the booking's submit: Enter here chooses the highlighted match, or searches at once.
        event.preventDefault()
        if (shown && active >= 0 && matches) choose(matches[active])
        else if (term !== null && term !== sent && !blockedBy && waiting === 0) search(term)
        return
      case "Escape":
        // The matches first, then the search; only an empty search lets Escape close the dialog.
        if (shown) {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
          setActive(-1)
        } else if (typed !== "") {
          event.preventDefault()
          event.stopPropagation()
          change("")
        }
        return
    }
  }

  const line = blockedBy || term === null ? (
    "Search earlier bookings by registration, email, phone or name."
  ) : searching ? (
    <>
      <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin" />
      <span>Searching earlier bookings…</span>
    </>
  ) : matches ? (
    matchesLine(matches.length)
  ) : (
    "Search earlier bookings by registration, email, phone or name."
  )

  return (
    <div data-slot="returning-customer" className="flex flex-col gap-3">
      <Field className="gap-1.5">
        <FieldLabel htmlFor={ids.input}>Returning customer</FieldLabel>
        {/* The matches open under the line below the box, over the fields they fill in; the box and the line stay in view. */}
        <div className="relative flex flex-col gap-1.5">
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              id={ids.input}
              type="search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={shown}
              aria-controls={shown ? ids.listbox : undefined}
              aria-activedescendant={shown && active >= 0 ? optionId(active) : undefined}
              aria-describedby={[ids.line, blockedBy].filter(Boolean).join(" ")}
              value={typed}
              onChange={(event) => change(event.target.value)}
              onKeyDown={keyDown}
              onFocus={() => setOpen(true)}
              onBlur={() => {
                setOpen(false)
                setActive(-1)
              }}
              disabled={Boolean(blockedBy)}
              maxLength={LOOKUP_MAX_LENGTH}
              // Personal data: never kept by the browser's own form history, corrected or capitalised.
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="search"
              className="scroll-mt-24 scroll-mb-28 pl-9"
            />
          </div>
          {/* Read as the box's description; what it says once an answer is in is announced by the status below, once. */}
          <p id={ids.line} aria-hidden="true" className="flex min-h-4 items-center gap-1.5 text-xs text-muted-foreground">
            {line}
          </p>
          {shown && matches && (
            <ul
              ref={listRef}
              id={ids.listbox}
              role="listbox"
              aria-label="Earlier bookings"
              // A press inside the list (an option, its scroll bar) keeps the focus in the box.
              onMouseDown={(event) => event.preventDefault()}
              // Three matches and half the fourth: a longer list shows that it scrolls.
              className="absolute inset-x-0 top-full z-30 mt-1 flex max-h-70 flex-col gap-1 overflow-y-auto overscroll-contain rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
            >
              {matches.map((match, index) => (
                <li
                  key={`${match.customer.email}|${match.vehicle.vin}`}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  aria-label={matchLabel(match, timeZone, today)}
                  onClick={() => choose(match)}
                  onMouseMove={() => index !== active && setActive(index)}
                  // A hairline between matches (inset like the text), so each three-line match reads as one.
                  className="relative flex min-h-11 shrink-0 cursor-pointer flex-col gap-0.5 rounded-md px-3 py-2.5 text-sm not-first:before:pointer-events-none not-first:before:absolute not-first:before:inset-x-3 not-first:before:-top-0.5 not-first:before:h-px not-first:before:bg-border aria-selected:bg-accent aria-selected:text-accent-foreground"
                >
                  <span className="flex min-w-0 items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-semibold">{match.customer.name}</span>
                    <span className="plate-chip shrink-0">
                      <span className="sr-only">Registration </span>
                      {match.vehicle.registration}
                    </span>
                  </span>
                  <span className="flex min-w-0 items-baseline justify-between gap-3 text-xs text-muted-foreground">
                    <span className="min-w-0 truncate">{contactOf(match)}</span>
                    <span className="max-w-[50%] shrink-0 truncate text-right">{vehicleOf(match)}</span>
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">{visitLine(match, timeZone, today)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {/* The count, read out politely as each answer arrives (the line above also says "Searching", so it is not live). */}
        <p role="status" className="sr-only">
          {matches ? matchesLine(matches.length) : ""}
        </p>
      </Field>

      {limited ? (
        <ProblemAlert
          tone="info"
          title={waiting > 0 ? `Too many requests - try again in ${waiting} s` : "Too many requests - try again now"}
          error={limited}
          onRetry={term !== null ? retry : undefined}
          retrying={lookup.isPending && current}
          retryDisabled={waiting > 0}
        />
      ) : failed ? (
        <LookupProblem error={failed} retrying={lookup.isPending && current} onRetry={retry} />
      ) : null}

      {filledFrom && (
        <div
          ref={noteRef}
          id={ids.note}
          tabIndex={-1}
          data-slot="returning-note"
          className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 py-1 pr-1 pl-3 text-xs text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <History aria-hidden="true" className="size-4 shrink-0" />
          <p className="min-w-0 flex-1 py-1 text-pretty">
            Details from the booking on <span className="font-medium whitespace-nowrap text-foreground">{bookingDay(filledFrom, timeZone)}</span>.
            Check they are still right.
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={clear} aria-label="Clear the details from that booking" className="text-foreground">
            Clear
          </Button>
        </div>
      )}
    </div>
  )
}

/** A search that failed, other than a rate limit: the app's problem alert, with Try again where trying again can help. */
function LookupProblem({ error, retrying, onRetry }: { error: unknown; retrying: boolean; onRetry: () => void }) {
  const status = failureStatus(error)
  const problem = parseProblem(error)
  if (status === 401 || status === 403) {
    return <ProblemAlert tone="warning" title={authRefusalTitle(status, "search earlier bookings")} error={error} />
  }
  if (status !== undefined && status < 500) {
    return <ProblemAlert tone="warning" title={problem?.title ?? `The server answered ${status}`} error={error} />
  }
  return (
    <ProblemAlert title="Couldn’t search earlier bookings" error={error} onRetry={onRetry} retrying={retrying}>
      <span>You can still enter the details below.</span>
    </ProblemAlert>
  )
}

