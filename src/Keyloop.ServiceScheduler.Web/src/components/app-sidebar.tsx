"use client"

import * as React from "react"
import { ArrowUpRight, BookOpenText, CalendarRange, ClipboardList, ListChecks, UsersRound, Warehouse } from "lucide-react"

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
  useSidebar,
} from "@/components/ui/sidebar"
import { DEALERSHIP_PARAM, WORKSHOP_PARAMS } from "@/lib/workshop-params"

const data = {
  navGroups: [
    {
      label: "Workshop",
      items: [
        {
          title: "Dispatch board",
          url: "/dispatch",
          icon: CalendarRange,
          carry: WORKSHOP_PARAMS,
        },
        {
          title: "Appointments",
          url: "/appointments",
          icon: ClipboardList,
          carry: WORKSHOP_PARAMS,
        },
      ],
    },
    {
      // One dealership's resources, measured today: the links carry the dealership, not the workshop pages' day.
      label: "Resources",
      items: [
        { title: "Technicians", url: "/resources/technicians", icon: UsersRound, carry: [DEALERSHIP_PARAM] },
        { title: "Bays", url: "/resources/bays", icon: Warehouse, carry: [DEALERSHIP_PARAM] },
        { title: "Services", url: "/resources/services", icon: ListChecks, carry: [DEALERSHIP_PARAM] },
      ],
    },
  ],
}

/**
 * The app frame's navigation. The brand lives in the header (UI_DESIGN 11.1); only the phone's sidebar sheet, which
 * covers the header, repeats the glyph and the "Keyloop" wordmark (as text, not a link). The footer says plainly what
 * this app is.
 */
export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { isMobile } = useSidebar()

  return (
    <Sidebar {...props}>
      {isMobile && (
        <SidebarHeader>
          <div className="flex items-center gap-2 p-2">
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <Logo size={20} />
            </div>
            <div className="grid flex-1 text-left leading-tight">
              <span className="truncate font-heading text-wordmark font-extrabold tracking-tight">Keyloop</span>
              <span className="truncate text-xs text-muted-foreground">Service Scheduler</span>
            </div>
          </div>
        </SidebarHeader>
      )}
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
              <ArrowUpRight className="ml-auto text-muted-foreground" />
              <span className="sr-only">(opens in a new tab)</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <NavUser />
        {/* Provenance (UI_DESIGN 11.1): not dismissible, so no screenshot or video frame can pass for a Keyloop product. */}
        <p className="px-2 pb-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          Take-home demo · inspired by Keyloop&apos;s public design language · not an official Keyloop product
        </p>
      </SidebarFooter>
    </Sidebar>
  )
}
