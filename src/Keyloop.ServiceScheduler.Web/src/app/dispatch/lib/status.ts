import { Ban, CalendarCheck, CircleCheck, KeyRound, type LucideIcon, UserX, Wrench } from "lucide-react"

import type { AppointmentStatus } from "@/api/types.gen"

/** The token slug of a status in src/index.css (`--status-<tone>-bg`, `-border`, `-fg`). */
export type StatusTone = "confirmed" | "checked-in" | "in-progress" | "completed" | "no-show" | "cancelled"

export interface StatusMeta {
  /** Plain words, as on the legend and in the details sheet. */
  label: string
  /** Distinct icon per status so colour is never the only signal. */
  icon: LucideIcon
  tone: StatusTone
  /** Full class strings (Tailwind only sees literal class names). */
  classes: {
    /** An appointment block or agenda card: tint, solid left bar, label text. */
    block: string
    /** A badge or icon tile: tint, label text, a hairline ring in the bar colour. */
    badge: string
    /** A legend swatch or status dot. */
    dot: string
    /** The solid left bar of a card on a neutral surface (the phone agenda). */
    bar: string
    /** Tinted icon tile in the status colour. */
    tile: string
  }
}

export const statusMeta: Record<AppointmentStatus, StatusMeta> = {
  Confirmed: {
    label: "Confirmed",
    icon: CalendarCheck,
    tone: "confirmed",
    classes: {
      block: "bg-status-confirmed-bg border-status-confirmed-border text-status-confirmed-fg",
      badge: "bg-status-confirmed-bg text-status-confirmed-fg ring-status-confirmed-border/40",
      dot: "bg-status-confirmed-border",
      bar: "border-status-confirmed-border",
      tile: "bg-status-confirmed-bg text-status-confirmed-fg rounded-chip",
    },
  },
  CheckedIn: {
    label: "Checked in",
    icon: KeyRound,
    tone: "checked-in",
    classes: {
      block: "bg-status-checked-in-bg border-status-checked-in-border text-status-checked-in-fg",
      badge: "bg-status-checked-in-bg text-status-checked-in-fg ring-status-checked-in-border/40",
      dot: "bg-status-checked-in-border",
      bar: "border-status-checked-in-border",
      tile: "bg-status-checked-in-bg text-status-checked-in-fg rounded-chip",
    },
  },
  InProgress: {
    label: "In progress",
    icon: Wrench,
    tone: "in-progress",
    classes: {
      block: "bg-status-in-progress-bg border-status-in-progress-border text-status-in-progress-fg",
      badge: "bg-status-in-progress-bg text-status-in-progress-fg ring-status-in-progress-border/40",
      dot: "bg-status-in-progress-border",
      bar: "border-status-in-progress-border",
      tile: "bg-status-in-progress-bg text-status-in-progress-fg rounded-chip",
    },
  },
  Completed: {
    label: "Completed",
    icon: CircleCheck,
    tone: "completed",
    classes: {
      block: "bg-status-completed-bg border-status-completed-border text-status-completed-fg",
      badge: "bg-status-completed-bg text-status-completed-fg ring-status-completed-border/40",
      dot: "bg-status-completed-border",
      bar: "border-status-completed-border",
      tile: "bg-status-completed-bg text-status-completed-fg rounded-chip",
    },
  },
  Cancelled: {
    label: "Cancelled",
    icon: Ban,
    tone: "cancelled",
    classes: {
      block: "bg-status-cancelled-bg border-status-cancelled-border text-status-cancelled-fg",
      badge: "bg-status-cancelled-bg text-status-cancelled-fg ring-status-cancelled-border/40",
      dot: "bg-status-cancelled-border",
      bar: "border-status-cancelled-border",
      tile: "bg-status-cancelled-bg text-status-cancelled-fg rounded-chip",
    },
  },
  NoShow: {
    label: "No-show",
    icon: UserX,
    tone: "no-show",
    classes: {
      block: "bg-status-no-show-bg border-status-no-show-border text-status-no-show-fg",
      badge: "bg-status-no-show-bg text-status-no-show-fg ring-status-no-show-border/40",
      dot: "bg-status-no-show-border",
      bar: "border-status-no-show-border",
      tile: "bg-status-no-show-bg text-status-no-show-fg rounded-chip",
    },
  },
}

/** Statuses shown on the dispatch board in lifecycle order (cancelled appointments are excluded). */
export const boardStatuses: readonly AppointmentStatus[] = ["Confirmed", "CheckedIn", "InProgress", "Completed", "NoShow"]

/** Statuses that actively occupy their bay and technician. */
export const activeStatuses: readonly AppointmentStatus[] = ["Confirmed", "CheckedIn", "InProgress"]

/** Returns true if an appointment in `status` can be cancelled. */
export function canCancel(status: AppointmentStatus): boolean {
  return status === "Confirmed" || status === "CheckedIn"
}
