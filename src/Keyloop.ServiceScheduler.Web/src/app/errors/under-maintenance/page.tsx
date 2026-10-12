import { Construction } from "lucide-react"

import { ErrorPage } from "../components/error-page"
import { RetryAction } from "../components/retry-action"

/** 503 (`/errors/under-maintenance`): the scheduler is being updated; nothing booked is lost. */
export default function UnderMaintenancePage() {
  return (
    <ErrorPage title="Down for maintenance" illustration="closed-day" badge={Construction} action={<RetryAction />}>
      <p>The scheduler is being updated. Bookings already made are kept.</p>
      <p>Try again in a few minutes.</p>
    </ErrorPage>
  )
}
