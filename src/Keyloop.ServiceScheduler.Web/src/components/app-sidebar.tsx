"use client"

import * as React from "react"
import { ArrowUpRight, BookOpenText, CalendarRange, ClipboardList } from "lucide-react"
import { Link } from "react-router-dom"

import { Logo } from "@/components/logo"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const data = {
  navGroups: [
    {
      label: "Workshop",
      items: [
        {
          title: "Dispatch Board",
          url: "/dispatch",
          icon: CalendarRange,
        },
        {
          title: "Appointments",
          url: "/appointments",
          icon: ClipboardList,
        },
      ],
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/dispatch" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Logo size={20} />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-[0.9375rem] font-semibold tracking-tight">
                  Keyloop
                </span>
                <span className="truncate text-xs text-sidebar-foreground/70">
                  Service Scheduler
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {data.navGroups.map((group) => (
          <NavMain key={group.label} label={group.label} items={group.items} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="cursor-pointer"
              render={
                <a href="/scalar/v1" target="_blank" rel="noopener noreferrer" />
              }
            >
              <BookOpenText />
              <span>API reference</span>
              <ArrowUpRight className="ml-auto text-sidebar-foreground/60" />
              <span className="sr-only">(opens in a new tab)</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
