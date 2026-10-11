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

export function NavMain({
  label,
  items,
}: {
  label: string
  items: {
    title: string
    url: string
    icon?: LucideIcon
  }[]
}) {
  const location = useLocation()
  const labelId = React.useId()

  const isActive = (url: string) =>
    location.pathname === url || location.pathname.startsWith(`${url}/`)

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
                    to={item.url}
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
