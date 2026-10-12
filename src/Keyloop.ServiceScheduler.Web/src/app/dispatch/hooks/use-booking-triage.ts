import { useMutation, useQuery } from "@tanstack/react-query"
import { useRef, useState } from "react"

import { getBookingTriageStatusOptions, triageBookingRequestMutation } from "@/api/@tanstack/react-query.gen"
import type { TriageBookingResponse } from "@/api/types.gen"
import { useCountdown } from "@/hooks/use-countdown"
import { useMutationFailure } from "@/hooks/use-mutation-failure"
import { fieldErrors, parseProblem, problemSlug, UnexpectedResponseError } from "@/lib/problem-details"
import { withSpan } from "@/lib/telemetry"

/**
 * `GET /booking-triage`: a deployment setting, read once and kept. The booking dialog asks for it as soon as the board shows
 * (while it is still closed), so the section is in place from the dialog's first frame instead of arriving after it.
 */
export const bookingTriageStatusQuery = () => ({ ...getBookingTriageStatusOptions(), staleTime: 10 * 60_000 })

/** The answer on screen, with the description it was for (to say when the text has changed since). */
export interface TriageAnswer {
  response: TriageBookingResponse
  description: string
}

/**
 * Booking intake triage (ARCHITECTURE §8.10) for one booking: whether suggestions are on, the description, the last
 * answer and the candidate chosen in it, and the "copy into Notes" choice. It lives with the booking flow rather than in
 * step 1, so all of it is still there when the person comes back from step 2.
 *
 * Privacy: the description stays in this state. It leaves the browser only as the body of the triage request (never in an
 * address, a query key or a span attribute), and in the booking's notes when the person keeps the copy box ticked.
 */
export function useBookingTriage(dealershipId: string) {
  // A failed read, or `enabled: false`, hides the section.
  const status = useQuery(bookingTriageStatusQuery())
  const [description, setDescription] = useState("")
  const [copyToNotes, setCopyToNotes] = useState(true)
  const [answer, setAnswer] = useState<TriageAnswer | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [descriptionError, setDescriptionError] = useState<string | null>(null)
  const [waiting, startWaiting] = useCountdown()
  const lastSent = useRef<string | null>(null)

  const generated = triageBookingRequestMutation()
  const request = useMutation({
    ...generated,
    // The generated mutation inside a `ui.booking_triage` span, so the trace runs from the click through the API to the
    // gateway call. Its attributes name the dealership only: the description is never an attribute.
    mutationFn: (variables, context) =>
      withSpan("ui.booking_triage", ({ fetch }) => generated.mutationFn!({ ...variables, fetch }, context), {
        "keyloop.dealership_id": dealershipId,
      }),
    onSuccess: (response, variables) => {
      setAnswer({ response, description: variables.body.description })
      // Even a confident suggestion waits for the person's "Use this"; a "confirm" preselects nothing.
      setSelected(response.recommendation === "suggest" ? (response.services[0]?.serviceType.id ?? null) : null)
    },
    onError: (error) => {
      setAnswer(null)
      setSelected(null)
      const problem = parseProblem(error)
      if (problem && problemSlug(problem) === "validation-error") {
        setDescriptionError(fieldErrors(problem, { description: "Description" }).description ?? problem.detail ?? "Check the description.")
      }
      const httpStatus = problem?.status ?? (error instanceof UnexpectedResponseError ? error.status : undefined)
      if (httpStatus === 429) startWaiting(Math.max(1, Math.ceil(Number(problem?.retryAfterSeconds ?? 1))))
    },
  })
  // Kept while the same description is tried again, so the alert and its focused Try again stay until the answer.
  const failure = useMutationFailure(request)

  function send(text: string) {
    if (request.isPending || waiting > 0) return
    setDescriptionError(null)
    lastSent.current = text
    request.mutate({ path: { dealershipId }, body: { description: text } })
  }

  return {
    /** `true` once the API says suggestions are on; `false` while that is unknown, off, or could not be read. */
    enabled: status.data?.enabled === true,
    maxLength: status.data?.maxDescriptionLength ?? 500,
    description,
    setDescription(text: string) {
      setDescription(text)
      if (descriptionError) setDescriptionError(null)
    },
    copyToNotes,
    setCopyToNotes,
    answer,
    selected,
    setSelected,
    descriptionError,
    pending: request.isPending,
    failure,
    /** Seconds left of a rate limit's wait. */
    waiting,
    /** Asks for suggestions for the description as typed (trimmed); a blank one is the person's to fill in first. */
    suggest(): boolean {
      const text = description.trim()
      if (!text) {
        setDescriptionError("Describe the issue to get a suggestion.")
        return false
      }
      send(text)
      return true
    },
    /** The last description sent, again (Try again after a failure). */
    retry() {
      if (lastSent.current) send(lastSent.current)
    },
    /** A fresh start for the next booking (Book another). */
    reset() {
      setDescription("")
      setCopyToNotes(true)
      setAnswer(null)
      setSelected(null)
      setDescriptionError(null)
      lastSent.current = null
      request.reset()
    },
  }
}

export type BookingTriage = ReturnType<typeof useBookingTriage>
