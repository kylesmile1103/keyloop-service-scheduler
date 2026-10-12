// Adopted from shadcn-dashboard-landing-template (vite-version) `src/components/nav-user.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
"use client"

import { EllipsisVertical, Info, LogIn, LogOut, Monitor, Moon, RotateCw, Sun, UserRound } from "lucide-react"
import { Link } from "react-router-dom"

import { RoleBadges } from "@/components/auth/role-badges"
import { InitialsAvatar } from "@/components/initials-avatar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import type { Theme } from "@/contexts/theme-context"
import { type CurrentUser, useCurrentUser } from "@/hooks/use-current-user"
import { ACCOUNT_PATH, useSignInTarget } from "@/hooks/use-sign-in"
import { useTheme } from "@/hooks/use-theme"
import { nameOf, ROLE_LABELS } from "@/lib/session"

/** Menu items are 44 px tall in touch layouts (UI_DESIGN 17.3). */
const item = "cursor-pointer pointer-coarse:min-h-11"

/**
 * Who is acting (UI_DESIGN 11.20), from `GET /api/v1/me`: the sidebar footer's user row, the template's nav-user. Signed in,
 * it shows the name (or the email) and the role, and its menu the account with its role badges, Account and Sign out;
 * signed out, "Not signed in" and a menu with Sign in. The theme choice stays in the menu, where phones find it. On the
 * development server, whose identity is configuration, the menu says so instead of offering a sign-in or sign-out that
 * could not change it.
 */
export function NavUser() {
  const { isMobile } = useSidebar()
  const { theme, setTheme } = useTheme()
  const current = useCurrentUser()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                aria-busy={current.status === "loading" || undefined}
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground cursor-pointer pointer-coarse:min-h-12"
              />
            }
          >
            <UserRow current={current} />
            <EllipsisVertical className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--anchor-width) min-w-60 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <AccountItems current={current} />
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Theme</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(value) => setTheme(value as Theme)}
              >
                <DropdownMenuRadioItem value="light" className={item}>
                  <Sun />
                  Light
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark" className={item}>
                  <Moon />
                  Dark
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system" className={item}>
                  <Monitor />
                  Match system
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/** The row in the sidebar: the avatar, then who is signed in (or that nobody is) and their role. */
function UserRow({ current }: { current: CurrentUser }) {
  if (current.status === "loading") {
    return (
      <>
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <span className="grid flex-1 text-left text-sm leading-tight">
          <span className="truncate text-muted-foreground">Checking sign-in…</span>
        </span>
      </>
    )
  }
  if (!current.user?.authenticated) {
    return (
      <>
        <Avatar className="after:rounded-full">
          <AvatarFallback>
            <UserRound className="size-4" />
          </AvatarFallback>
        </Avatar>
        <span className="grid flex-1 text-left text-sm leading-tight">
          <span className="truncate font-medium">{current.status === "failed" ? "Sign-in not checked" : "Not signed in"}</span>
          <span className="truncate text-xs text-muted-foreground">Customer details masked</span>
        </span>
      </>
    )
  }
  const name = nameOf(current.user)
  return (
    <>
      <InitialsAvatar name={name.includes("@") ? name.split("@")[0].replace(/[._-]+/g, " ") : name} />
      <span className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {current.roles.length > 0 ? current.roles.map((role) => ROLE_LABELS[role]).join(", ") : "No role yet"}
        </span>
      </span>
    </>
  )
}

/** The menu's account part: the identity with Account and Sign out, or Sign in. */
function AccountItems({ current }: { current: CurrentUser }) {
  const signIn = useSignInTarget()
  const account = (
    <DropdownMenuLinkItem className={item} render={<Link to={ACCOUNT_PATH} />}>
      <UserRound />
      Account
    </DropdownMenuLinkItem>
  )

  if (current.user?.authenticated) {
    const { user } = current
    return (
      <DropdownMenuGroup>
        <DropdownMenuLabel className="flex flex-col gap-1.5 text-foreground">
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold">{nameOf(user)}</span>
            {user.displayName && user.email && <span className="truncate font-normal text-muted-foreground">{user.email}</span>}
          </span>
          <RoleBadges roles={current.roles} />
          {current.roles.length === 0 && (
            <span className="max-w-64 font-normal text-pretty text-muted-foreground">
              No workshop role yet: the workshop administrator assigns roles.
            </span>
          )}
          {/* In the group's label, so it is read with the items: there is no Sign out to offer here. */}
          {current.source === "configuration" && (
            <span className="flex max-w-64 items-start gap-1.5 font-normal text-pretty text-muted-foreground">
              <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              Signed in by this development server&apos;s configuration, so there is no sign-out here.
            </span>
          )}
        </DropdownMenuLabel>
        {account}
        {current.source === "access" && current.logoutUrl && (
          <DropdownMenuLinkItem className={item} href={current.logoutUrl}>
            <LogOut />
            Sign out
          </DropdownMenuLinkItem>
        )}
      </DropdownMenuGroup>
    )
  }

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className="max-w-64 text-xs leading-relaxed font-normal text-pretty text-foreground">
        {current.status === "failed"
          ? "Couldn’t check who is signed in, so the app treats you as signed out."
          : "Sign in with a workshop account to book, cancel and see customer details."}
      </DropdownMenuLabel>
      {current.status === "failed" && (
        <DropdownMenuItem className={item} closeOnClick={false} disabled={current.fetching} onClick={current.refetch}>
          <RotateCw className={current.fetching ? "animate-spin" : undefined} />
          Try again
        </DropdownMenuItem>
      )}
      {signIn.source === "configuration" ? (
        <DropdownMenuLinkItem className={item} render={<Link to={signIn.to} />}>
          <Info />
          {signIn.label}
        </DropdownMenuLinkItem>
      ) : (
        <DropdownMenuLinkItem className={item} href={signIn.href}>
          <LogIn />
          {signIn.label}
        </DropdownMenuLinkItem>
      )}
      {account}
    </DropdownMenuGroup>
  )
}
