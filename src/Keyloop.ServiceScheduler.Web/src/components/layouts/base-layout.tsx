"use client"

import * as React from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

interface BaseLayoutProps {
  children: React.ReactNode
  title?: string
  description?: string
  /** Page-level controls shown to the right of the title (dealership, date, actions). */
  actions?: React.ReactNode
}

export function BaseLayout({ children, title, description, actions }: BaseLayoutProps) {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "16rem",
          "--sidebar-width-icon": "3rem",
          "--header-height": "calc(var(--spacing) * 14)",
        } as React.CSSProperties
      }
    >
      {title && <title>{`${title} – Keyloop Service Scheduler`}</title>}
      <a
        href="#content"
        className="fixed top-3 left-3 z-50 -translate-y-20 rounded-md bg-background px-3 py-2 text-sm font-medium text-foreground shadow-md ring-2 ring-ring outline-none focus:translate-y-0"
      >
        Skip to content
      </a>
      <AppSidebar variant="inset" collapsible="offcanvas" />
      <SidebarInset>
        <SiteHeader />
        <div id="content" tabIndex={-1} className="flex flex-1 flex-col outline-none">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              {title && (
                <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-4 lg:px-6">
                  <div className="flex min-w-0 flex-col gap-1">
                    <h1 className="text-2xl font-semibold tracking-tight">
                      {title}
                    </h1>
                    {description && (
                      <p className="text-muted-foreground">{description}</p>
                    )}
                  </div>
                  {actions && (
                    <div className="flex flex-wrap items-center gap-2">{actions}</div>
                  )}
                </div>
              )}
              {children}
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
