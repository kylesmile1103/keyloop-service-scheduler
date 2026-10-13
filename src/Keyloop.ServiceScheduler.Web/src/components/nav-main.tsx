// Adopted from shadcn-dashboard-landing-template (vite-version) `src/components/nav-main.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License.
"use client"

import * as React from "react"
import { type LucideIcon } from "lucide-react"
import { Link, useLocation } from "react-router-dom"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { carrySearch } from "@/lib/workshop-params"

export function NavMain({
  label,
  items,
}: {
  label: string
  items: {
    title: string
    url: string
    icon?: LucideIcon
    /** Search parameters carried over from the current URL when navigating to a different route. */
    carry?: readonly string[]
  }[]
}) {
  const location = useLocation()
  const labelId = React.useId()

  const isActive = (url: string) =>
    location.pathname === url || location.pathname.startsWith(`${url}/`)

  const searchFor = (url: string, carry: readonly string[] | undefined) =>
    location.pathname === url ? location.search : carry ? carrySearch(location.search, carry) : ""

  return (
    <SidebarGroup>
      <SidebarGroupLabel id={labelId}>{label}</SidebarGroupLabel>
      <nav aria-labelledby={labelId}>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                className="cursor-pointer pointer-coarse:h-11"
                isActive={isActive(item.url)}
                render={
                  <Link
                    to={{ pathname: item.url, search: searchFor(item.url, item.carry) }}
                    aria-current={isActive(item.url) ? "page" : undefined}
                  />
                }
              >
                {item.icon && <item.icon />}
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </nav>
    </SidebarGroup>
  )
}
