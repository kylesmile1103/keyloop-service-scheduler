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
    /**
     * Search parameters the link carries over from the current address (the workshop pages share the dealership and the
     * day). A link to the page already open keeps its whole address, so it never resets that page's own view.
     */
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
