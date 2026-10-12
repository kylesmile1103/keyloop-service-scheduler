import bookingSuccess from "@/assets/illustrations/booking-success.webp"
import closedDay from "@/assets/illustrations/closed-day.webp"
import emptySchedule from "@/assets/illustrations/empty-schedule.webp"
import errorConnection from "@/assets/illustrations/error-connection.webp"
import forbidden from "@/assets/illustrations/forbidden.webp"
import maintenance from "@/assets/illustrations/maintenance.webp"
import noAvailability from "@/assets/illustrations/no-availability.webp"
import notFound from "@/assets/illustrations/not-found.webp"
import serverError from "@/assets/illustrations/server-error.webp"
import unauthorized from "@/assets/illustrations/unauthorized.webp"

/**
 * The state illustrations (UI_DESIGN 12.1): original artwork for this project, 1200 x 900 with a transparent margin, so
 * they read on light and dark cards. Imported, so Vite fingerprints them (each is far above the 4 KB inline limit): this
 * module holds only their addresses, and a picture is downloaded when a state that shows it renders, never before.
 */
export const illustrations = {
  "empty-schedule": emptySchedule,
  "closed-day": closedDay,
  "no-availability": noAvailability,
  "error-connection": errorConnection,
  "booking-success": bookingSuccess,
  // Wave 2: each error page's own picture.
  unauthorized,
  forbidden,
  "server-error": serverError,
  maintenance,
  "not-found": notFound,
} as const

export type Illustration = keyof typeof illustrations

/**
 * Each picture's alt text, from the images READMEs (UI_DESIGN 12.4, which the web project does not copy). A state whose
 * headline already says what its picture shows keeps it decorative (`alt=""`); a state shows this text when its picture
 * adds what the words do not (the wave-2 pictures, each its state's own).
 */
export const illustrationAlt: Record<Illustration, string> = {
  "empty-schedule": "Empty workshop service bay with a two-post lift and a blank calendar.",
  "closed-day": "Closed workshop shutter beneath a crescent moon and stars.",
  "no-availability": "Magnifying glass over a calendar with every slot filled.",
  "error-connection": "Disconnected cable plugs beneath a coral warning triangle.",
  "booking-success": "Silver hatchback with a green check mark and lavender-to-peach sparks.",
  unauthorized: "Car key fob beside an open padlock inviting sign-in.",
  forbidden: "Workshop bay behind a safety barrier with a wrench role badge.",
  "server-error": "Generic silver hatchback with an open bonnet, a steam wisp and a nearby wrench.",
  maintenance: "Silver hatchback raised on a two-post lift beside cones and a progress indicator.",
  "not-found": "Directional road sign pointing toward a short road closed by a barrier.",
}
