import bookingSuccess from "@/assets/illustrations/booking-success.webp"
import closedDay from "@/assets/illustrations/closed-day.webp"
import dashboardInsights from "@/assets/illustrations/dashboard-insights.webp"
import emptyCalendar from "@/assets/illustrations/empty-calendar.webp"
import emptySchedule from "@/assets/illustrations/empty-schedule.webp"
import emptyTechnicians from "@/assets/illustrations/empty-technicians.webp"
import errorConnection from "@/assets/illustrations/error-connection.webp"
import forbidden from "@/assets/illustrations/forbidden.webp"
import maintenance from "@/assets/illustrations/maintenance.webp"
import noAvailability from "@/assets/illustrations/no-availability.webp"
import notFound from "@/assets/illustrations/not-found.webp"
import photoEvidence from "@/assets/illustrations/photo-evidence.webp"
import serverError from "@/assets/illustrations/server-error.webp"
import signInToBook from "@/assets/illustrations/sign-in-to-book.webp"
import unauthorized from "@/assets/illustrations/unauthorized.webp"

/** State illustration asset URLs (1200x900 WebP with transparent margins for light and dark cards). */
export const illustrations = {
  "empty-schedule": emptySchedule,
  "closed-day": closedDay,
  "no-availability": noAvailability,
  "error-connection": errorConnection,
  "booking-success": bookingSuccess,
  unauthorized,
  forbidden,
  "server-error": serverError,
  maintenance,
  "not-found": notFound,
  "empty-technicians": emptyTechnicians,
  "photo-evidence": photoEvidence,
  "sign-in-to-book": signInToBook,
  "dashboard-insights": dashboardInsights,
  "empty-calendar": emptyCalendar,
} as const

export type Illustration = keyof typeof illustrations

/** Accessible alt text for each state illustration when not rendered decoratively (`alt=""`). */
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
  "empty-technicians": "Tool pegboard beside an open, empty technician locker.",
  "photo-evidence": "Phone camera framing an amber warning triangle on a generic vehicle dashboard.",
  "sign-in-to-book": "Calendar booking card beside a car key.",
  "dashboard-insights": "Workshop bay silhouette with rising blue bars and a simple gauge.",
  "empty-calendar": "Week-view calendar with open slots and a small generic car icon.",
}
