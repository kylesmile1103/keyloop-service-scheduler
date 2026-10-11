import { CircleCheck, CircleQuestionMark, CircleX, Clock, type LucideIcon, TriangleAlert } from "lucide-react"

import type { OutcomeKind } from "./stress"

export interface OutcomeMeta {
  /** The outcome in a word, as the legend and the tiles say it. */
  word: string
  /** Service Hub's traffic light (DESIGN_SYSTEM 9): check, triangle, cross, plus a clock and a question mark. */
  icon: LucideIcon
  /** The outcome tile and the status-code pill: the feedback tint with its ink. */
  tile: string
  /** The figure's colour on a card. */
  ink: string
  /** The stacked bar's segment. */
  bar: string
}

/** One map from outcome to word, icon and tokens, so every view shows an outcome the same way (DESIGN_SYSTEM 11.17, 17.2). */
export const outcomeMeta: Record<OutcomeKind, OutcomeMeta> = {
  booked: { word: "Booked", icon: CircleCheck, tile: "bg-success-subtle text-success", ink: "text-success", bar: "bg-success" },
  taken: { word: "Slot taken", icon: TriangleAlert, tile: "bg-warning-subtle text-warning", ink: "text-warning", bar: "bg-warning" },
  server: { word: "Server error", icon: CircleX, tile: "bg-destructive-subtle text-destructive", ink: "text-destructive", bar: "bg-destructive" },
  "rate-limited": { word: "Rate limited", icon: Clock, tile: "bg-info-subtle text-info", ink: "text-info", bar: "bg-info" },
  failed: { word: "No response", icon: CircleX, tile: "bg-destructive-subtle text-destructive", ink: "text-destructive", bar: "bg-destructive" },
  other: {
    word: "Other answer",
    icon: CircleQuestionMark,
    tile: "bg-secondary text-secondary-foreground",
    ink: "text-foreground",
    bar: "bg-muted-foreground",
  },
}

/** The tiles a run always shows, in this order; the others appear only when that outcome occurred. */
export const alwaysShown: readonly OutcomeKind[] = ["booked", "taken", "server"]
export const outcomeOrder: readonly OutcomeKind[] = ["booked", "taken", "server", "rate-limited", "failed", "other"]
