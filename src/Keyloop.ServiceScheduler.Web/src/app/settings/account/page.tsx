// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/settings/account/page.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { UserRound } from "lucide-react"
import { useId } from "react"

import { BaseLayout } from "@/components/layouts/base-layout"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"

/**
 * Account (`/settings/account`): who is signed in and with which roles. The API already authenticates every request
 * (ADR-027) but the app does not show the account yet, so the page says what each role may do instead of showing a
 * made-up user, as the sidebar's user row does; Task 27b fills it from `GET /api/v1/me` (the signed-in identity and its
 * Admin, ServiceAdvisor or Viewer role). The template's profile, password and delete-account forms are not kept: nothing
 * here is editable.
 */
export default function AccountPage() {
  const headingId = useId()

  return (
    <BaseLayout title="Account" description="Who you are signed in as and what you may do.">
      <div className="flex max-w-4xl flex-col gap-4 px-4 md:px-6 xl:px-8">
        <Card aria-labelledby={headingId} role="region">
          <CardHeader className="flex items-start gap-3">
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-chip bg-secondary text-secondary-foreground">
              <UserRound className="size-5" />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <h2 id={headingId} className="font-heading text-lg leading-snug font-semibold">
                Not shown in the app yet
              </h2>
              <p className="max-w-prose text-sm text-pretty text-muted-foreground">
                The scheduler checks who you are on every request, but this app does not offer sign-in yet. What each role
                may do:
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <ul aria-label="What each role may do" className="flex flex-col divide-y divide-border rounded-lg border border-border">
              <Fact term="View the schedule" value="Anyone; customer details are masked without a role" />
              <Fact term="Appointment details" value="Admin, Service advisor or Viewer" />
              <Fact term="Book, cancel and triage" value="Admin or Service advisor" />
            </ul>
          </CardContent>
          <CardFooter className="text-sm text-pretty text-muted-foreground">
            Once the app offers sign-in, this page shows the account you signed in with and its role: Admin, Service advisor
            or Viewer.
          </CardFooter>
        </Card>
      </div>
    </BaseLayout>
  )
}

/** One fact about the account: its name, then its value. */
function Fact({ term, value }: { term: string; value: string }) {
  return (
    <li className="flex flex-col gap-0.5 px-3 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="text-sm text-muted-foreground sm:w-36 sm:shrink-0">{term}</span>
      <span className="min-w-0 text-sm font-medium">{value}</span>
    </li>
  )
}
