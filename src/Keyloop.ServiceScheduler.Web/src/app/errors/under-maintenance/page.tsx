// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/errors/under-maintenance/components/under-maintenance-error.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { ErrorPage } from "../components/error-page"
import { RetryAction } from "../components/retry-action"

/** 503 (`/errors/under-maintenance`): the scheduler is temporarily unavailable; nothing booked is lost. */
export default function UnderMaintenancePage() {
  return (
    <ErrorPage title="Down for maintenance" illustration="maintenance" action={<RetryAction />}>
      <p>The scheduler is temporarily unavailable. Bookings already made are kept.</p>
      <p>Try again in a moment.</p>
    </ErrorPage>
  )
}
