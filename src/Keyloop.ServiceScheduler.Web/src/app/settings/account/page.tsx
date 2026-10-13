// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/settings/account/page.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { CircleCheck, CircleMinus, LogOut, Terminal, UserRound } from "lucide-react"
import { type ReactNode, useId } from "react"

import type { CurrentUserResponse } from "@/api/types.gen"
import { RoleBadges } from "@/components/auth/role-badges"
import { SignInAction } from "@/components/auth/sign-in-action"
import { CopyButton } from "@/components/copy-button"
import { InitialsAvatar } from "@/components/initials-avatar"
import { BaseLayout } from "@/components/layouts/base-layout"
import { ProblemAlert } from "@/components/problem-alert"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { type CurrentUser, useCurrentUser } from "@/hooks/use-current-user"
import { nameOf } from "@/lib/session"
import { cn } from "@/lib/utils"

/** Account settings page displaying the signed-in identity, roles, and allowed actions. */
export default function AccountPage() {
  const current = useCurrentUser()

  return (
    <BaseLayout title="Account" description="Who you are signed in as and what you may do.">
      <div className="flex max-w-4xl flex-col gap-4 px-4 md:px-6 xl:px-8">
        {current.status === "loading" ? (
          <Card role="status" aria-label="Checking who is signed in">
            <CardHeader className="flex items-center gap-3">
              <Skeleton className="size-12 shrink-0 rounded-full" />
              <span className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-64 max-w-full" />
              </span>
            </CardHeader>
          </Card>
        ) : (
          <IdentityCard current={current} />
        )}
        {current.source === "configuration" && <DevelopmentIdentityCard />}
      </div>
    </BaseLayout>
  )
}

function IdentityCard({ current }: { current: CurrentUser }) {
  const headingId = useId()
  const user = current.user?.authenticated ? current.user : null

  return (
    <Card aria-labelledby={headingId} role="region">
      <CardHeader className="flex items-start gap-4">
        {user ? (
          <InitialsAvatar size="lg" name={avatarName(user)} />
        ) : (
          <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
            <UserRound className="size-6" />
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 id={headingId} className="font-heading text-lg leading-snug font-semibold wrap-break-word">
            {user ? nameOf(user) : "You’re not signed in"}
          </h2>
          {user ? (
            <>
              {user.displayName && user.email && <p className="text-sm break-all text-muted-foreground">{user.email}</p>}
              <RoleBadges roles={current.roles} className="pt-0.5" />
            </>
          ) : (
            <p className="max-w-prose text-sm text-pretty text-muted-foreground">
              Anyone can view the board and the appointments list, with customer names, VINs and plates masked.
            </p>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {current.status === "failed" && (
          <ProblemAlert
            title="Couldn’t check who is signed in"
            error={current.error}
            onRetry={current.refetch}
            retrying={current.fetching}
          />
        )}
        <h3 className="text-sm font-medium">What you can do</h3>
        <ul aria-label="What you can do" className="flex flex-col divide-y divide-border rounded-lg border border-border">
          <Fact allowed>View the board and the appointments list{current.canViewDetails ? "" : ", with customer details masked"}</Fact>
          <Fact allowed={current.canViewDetails}>See customer names, contact details and vehicles</Fact>
          <Fact allowed={current.canWrite}>Book, cancel and ask for service suggestions</Fact>
          <Fact allowed={current.canOpenResources}>Open Resources: technicians, bays and services</Fact>
        </ul>
        {user && current.roles.length === 0 && (
          <p className="text-sm text-pretty text-muted-foreground">
            Your account has no workshop role yet. Roles (Admin, Service advisor, Viewer) are assigned by the workshop
            administrator.
          </p>
        )}
      </CardContent>
      {current.source === "access" && (
        <CardFooter className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {user ? (
            current.logoutUrl && (
              <>
                <a href={current.logoutUrl} className={cn(buttonVariants({ variant: "outline" }))}>
                  <LogOut aria-hidden="true" />
                  Sign out
                </a>
                <span className="text-sm text-pretty text-muted-foreground">
                  Ends your Cloudflare Access session, on this site and any other app it protects.
                </span>
              </>
            )
          ) : (
            <>
              <SignInAction />
              <span className="text-sm text-pretty text-muted-foreground">Sign in with your workshop account; you come back here.</span>
            </>
          )}
        </CardFooter>
      )}
    </Card>
  )
}

function avatarName(user: CurrentUserResponse): string {
  return user.displayName?.trim() || (user.email ?? "").split("@")[0].replace(/[._-]+/g, " ")
}

function Fact({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  const Icon = allowed ? CircleCheck : CircleMinus
  return (
    <li className="flex items-start gap-2.5 px-3 py-2.5 text-sm">
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", allowed ? "text-success" : "text-muted-foreground")} />
      <span className={cn("min-w-0", !allowed && "text-muted-foreground")}>
        <span className="sr-only">{allowed ? "Yes: " : "No: "}</span>
        {children}
      </span>
    </li>
  )
}

const developmentRoles = [
  { name: "Admin (the default)", value: "Admin" },
  { name: "Service advisor", value: "ServiceAdvisor" },
  { name: "Viewer", value: "Viewer" },
  { name: "Signed out", value: "" },
] as const

/** Displays instructions for switching roles via configuration on the development server. */
function DevelopmentIdentityCard() {
  const headingId = useId()
  return (
    <Card aria-labelledby={headingId} role="region">
      <CardHeader className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-chip bg-secondary text-secondary-foreground">
          <Terminal className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={headingId} className="font-heading text-lg leading-snug font-semibold">
            How to sign in on this development server
          </h2>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">
            Here the API takes who you are from its configuration, not from a sign-in page, so there is nothing to sign in to
            or out of. To try another role, restart the API with one of these settings.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <ul aria-label="Development identities" className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {developmentRoles.map(({ name, value }) => {
            const setting = `Auth__Development__Roles__0=${value}`
            return (
              <li key={name} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:gap-4">
                <span className="text-sm text-muted-foreground sm:w-40 sm:shrink-0">{name}</span>
                <span className="flex min-w-0 items-center gap-1">
                  <code className="min-w-0 font-mono text-xs break-all">{setting}</code>
                  <CopyButton value={setting} label={`Copy the setting for ${name}`} copiedLabel="Setting copied" />
                </span>
              </li>
            )
          })}
        </ul>
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-1.5 text-sm text-pretty text-muted-foreground">
        <p>With the AppHost, pass the role as a parameter instead (comma-separated for several, empty to be signed out):</p>
        <code className="max-w-full font-mono text-xs break-all text-foreground">--Parameters:auth-development-roles=ServiceAdvisor</code>
        <p>
          The email comes from <code className="font-mono text-xs">Auth__Development__Email</code>, admin@keyloop.test by default.
        </p>
      </CardFooter>
    </Card>
  )
}
