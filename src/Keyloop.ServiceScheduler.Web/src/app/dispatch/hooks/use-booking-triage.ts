import { useQuery } from "@tanstack/react-query"
import { useRef, useState } from "react"

import { getBookingTriageStatusOptions, triageBookingRequestMutation } from "@/api/@tanstack/react-query.gen"
import { uploadBookingTriageImage } from "@/api/sdk.gen"
import type { TriageBookingResponse } from "@/api/types.gen"
import { useCountdown } from "@/hooks/use-countdown"
import { useMutationFailure } from "@/hooks/use-mutation-failure"
import { useWriteMutation } from "@/hooks/use-write-mutation"
import { fieldErrors, parseProblem, problemSlug, UnexpectedResponseError } from "@/lib/problem-details"
import { withSpan } from "@/lib/telemetry"

export const bookingTriageStatusQuery = () => ({ ...getBookingTriageStatusOptions(), staleTime: 10 * 60_000 })

export interface TriageAnswer {
  response: TriageBookingResponse
  description: string
  imageVersion: number
}

interface Submission {
  description: string
  photos: File[]
  imageVersion: number
  flowVersion: number
}

function imageBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "")
    reader.onerror = () => reject(new Error("The photo could not be read. Choose it again."))
    reader.readAsDataURL(file)
  })
}

/** Description and photos stay in dialog state; neither is a cache key or telemetry attribute. */
export function useBookingTriage(dealershipId: string) {
  const status = useQuery(bookingTriageStatusQuery())
  const [description, setDescription] = useState("")
  const [photos, setPhotos] = useState<File[]>([])
  const [imageVersion, setImageVersion] = useState(0)
  const [imageError, setImageError] = useState<string | null>(null)
  const [copyToNotes, setCopyToNotes] = useState(true)
  const [answer, setAnswer] = useState<TriageAnswer | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [descriptionError, setDescriptionError] = useState<string | null>(null)
  const [waiting, startWaiting] = useCountdown()
  const lastSent = useRef<Submission | null>(null)
  const flowVersion = useRef(0)
  const uploads = useRef(new Map<File, { id: string; expires: number }>())
  const maxImages = status.data?.maxImages ?? 4
  const maxImageBytes = status.data?.maxImageBytes ?? 4 * 1024 * 1024
  const maxTotalImageBytes = status.data?.maxTotalImageBytes ?? 8 * 1024 * 1024

  const generated = triageBookingRequestMutation()
  // Uploads and the evaluation are writes (`BookingsWrite`), bound to the account the dialog was drawn for: checked as they
  // are sent and again after every step awaited (reading a photo, each upload), so nothing is sent for anyone else and a
  // role lost meanwhile sends nothing more; an answer that arrives after the identity changed is thrown away
  // (`useWriteMutation`), and no upload of the previous caller's is kept for reuse.
  const request = useWriteMutation({
    mutationFn: (submission: Submission, guard, context) =>
      withSpan("ui.booking_triage", async ({ fetch }) => {
        const imageIds: string[] = []
        for (const photo of submission.photos) {
          let upload = uploads.current.get(photo)
          if (!upload || upload.expires <= Date.now() + 30_000) {
            const base64 = await imageBase64(photo)
            guard()
            const response = await uploadBookingTriageImage({
              path: { dealershipId },
              body: { contentType: photo.type, base64 },
              fetch,
              throwOnError: true,
            })
            guard()
            upload = { id: response.data.imageId, expires: Date.parse(response.data.expiresAt) }
            uploads.current.set(photo, upload)
          }
          imageIds.push(upload.id)
        }
        guard()
        return generated.mutationFn!({
          path: { dealershipId },
          body: { description: submission.description, ...(imageIds.length ? { imageIds } : {}) },
          fetch,
        }, context)
      }, { "keyloop.dealership_id": dealershipId }),
    onSuccess: (response, submission) => {
      if (submission.flowVersion !== flowVersion.current) return
      setAnswer({ response, description: submission.description, imageVersion: submission.imageVersion })
      setSelected(response.recommendation === "suggest" ? (response.services[0]?.serviceType.id ?? null) : null)
    },
    onError: (error, submission) => {
      if (submission.flowVersion !== flowVersion.current) return
      setAnswer(null)
      setSelected(null)
      const problem = parseProblem(error)
      if (problem && problemSlug(problem) === "validation-error") {
        const errors = fieldErrors(problem, { description: "Description", imageIds: "Photos", base64: "Photo", contentType: "Photo type" })
        const mediaError = errors.imageIds ?? errors.base64 ?? errors.contentType
        if (mediaError) {
          setImageError(mediaError)
          uploads.current.clear()
        } else setDescriptionError(errors.description ?? problem.detail ?? "Check the description.")
      }
      const httpStatus = problem?.status ?? (error instanceof UnexpectedResponseError ? error.status : undefined)
      if (httpStatus === 429) startWaiting(Math.max(1, Math.ceil(Number(problem?.retryAfterSeconds ?? 1))))
    },
  })
  const failure = useMutationFailure(request)

  function send(text: string) {
    if (request.isPending || waiting > 0) return
    // The identity in the cache decides, not the last render: a press can come after `/me` changed and before the view
    // has drawn it (Try again included), to nobody or to another account.
    const write = request.begin()
    if (!write) return
    setDescriptionError(null)
    setImageError(null)
    const submission = { description: text, photos: [...photos], imageVersion, flowVersion: flowVersion.current }
    lastSent.current = submission
    write(submission)
  }

  return {
    enabled: status.data?.enabled === true,
    imagesEnabled: status.data?.imagesEnabled === true,
    provider: status.data?.provider ?? "Clef-flash via Cloudflare AI Gateway",
    maxLength: status.data?.maxDescriptionLength ?? 500,
    maxImages,
    photos,
    imageVersion,
    imageError,
    addPhotos(files: File[]) {
      const next = [...photos, ...files]
      if (next.length > maxImages) { setImageError(`Choose at most ${maxImages} photos.`); return }
      if (files.some(file => !["image/png", "image/jpeg", "image/webp"].includes(file.type))) {
        setImageError("Choose PNG, JPEG or WebP photos."); return
      }
      if (files.some(file => file.size === 0 || file.size > maxImageBytes)) {
        setImageError("Each photo must contain 1 byte to 4 MiB."); return
      }
      if (next.reduce((total, file) => total + file.size, 0) > maxTotalImageBytes) {
        setImageError("Photos must total at most 8 MiB."); return
      }
      setPhotos(next)
      setImageVersion(value => value + 1)
      setImageError(null)
    },
    removePhoto(index: number) {
      const photo = photos[index]
      if (photo) uploads.current.delete(photo)
      setPhotos(photos.filter((_, position) => position !== index))
      setImageVersion(value => value + 1)
      setImageError(null)
    },
    description,
    setDescription(text: string) { setDescription(text); if (descriptionError) setDescriptionError(null) },
    copyToNotes,
    setCopyToNotes,
    answer,
    selected,
    setSelected,
    descriptionError,
    pending: request.isPending,
    failure,
    waiting,
    suggest(): boolean {
      const text = description.trim()
      if (!text) { setDescriptionError("Describe the issue to get a suggestion."); return false }
      send(text)
      return true
    },
    retry() { if (lastSent.current) send(lastSent.current.description) },
    reset() {
      flowVersion.current++
      setDescription("")
      setPhotos([])
      setImageVersion(0)
      setImageError(null)
      uploads.current.clear()
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
