import bookingSuccess from "@/assets/illustrations/booking-success.webp"
import closedDay from "@/assets/illustrations/closed-day.webp"
import emptySchedule from "@/assets/illustrations/empty-schedule.webp"
import errorConnection from "@/assets/illustrations/error-connection.webp"
import noAvailability from "@/assets/illustrations/no-availability.webp"

/**
 * The state illustrations (UI_DESIGN 12.1): original artwork for this project, 1200 x 900 with a transparent margin, so
 * they read on light and dark cards. Imported, so Vite fingerprints them (each is far above the 4 KB inline limit).
 */
export const illustrations = {
  "empty-schedule": emptySchedule,
  "closed-day": closedDay,
  "no-availability": noAvailability,
  "error-connection": errorConnection,
  "booking-success": bookingSuccess,
} as const

export type Illustration = keyof typeof illustrations
