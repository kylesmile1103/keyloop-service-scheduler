// Adopted from shadcn-dashboard-landing-template (vite-version) `src/config/routes.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License.
import type { ComponentType } from "react"
import type { RouteObject } from "react-router-dom"

import { KeepSearch } from "@/components/router/keep-search"
import { RootErrorBoundary, RootFallback, RootLayout } from "@/components/router/root-layout"

/** Wraps a dynamic page import for React Router's `lazy` route loader. */
function page(load: () => Promise<{ default: ComponentType }>) {
  return async () => ({ Component: (await load()).default })
}

export const routes: RouteObject[] = [
  { path: "/", element: <KeepSearch to="overview" /> },
  // Workshop
  { path: "/overview", lazy: page(() => import("@/app/overview/page")) },
  { path: "/dispatch", lazy: page(() => import("@/app/dispatch/page")) },
  { path: "/calendar", lazy: page(() => import("@/app/calendar/page")) },
  { path: "/appointments", lazy: page(() => import("@/app/appointments/page")) },
  // Resources (admin area with lazy-loaded Refine layout)
  {
    path: "/resources",
    lazy: page(() => import("@/app/admin/layout")),
    children: [
      { index: true, element: <KeepSearch to="technicians" /> },
      { path: "technicians", lazy: page(() => import("@/app/admin/technicians/page")) },
      { path: "bays", lazy: page(() => import("@/app/admin/bays/page")) },
      { path: "services", lazy: page(() => import("@/app/admin/services/page")) },
      { path: "policy", lazy: page(() => import("@/app/admin/policy/page")) },
      { path: "history", lazy: page(() => import("@/app/admin/history/page")) },
    ],
  },
  // Settings
  { path: "/settings", element: <KeepSearch to="appearance" /> },
  { path: "/settings/appearance", lazy: page(() => import("@/app/settings/appearance/page")) },
  { path: "/settings/account", lazy: page(() => import("@/app/settings/account/page")) },
  // Error pages
  { path: "/errors/unauthorized", lazy: page(() => import("@/app/errors/unauthorized/page")) },
  { path: "/errors/forbidden", lazy: page(() => import("@/app/errors/forbidden/page")) },
  { path: "/errors/not-found", lazy: page(() => import("@/app/errors/not-found/page")) },
  { path: "/errors/internal-server-error", lazy: page(() => import("@/app/errors/internal-server-error/page")) },
  { path: "/errors/under-maintenance", lazy: page(() => import("@/app/errors/under-maintenance/page")) },
  { path: "*", lazy: page(() => import("@/app/errors/not-found/page")) },
]

export const appRoutes: RouteObject[] = [
  {
    element: <RootLayout />,
    HydrateFallback: RootFallback,
    errorElement: <RootErrorBoundary />,
    children: routes,
  },
]
