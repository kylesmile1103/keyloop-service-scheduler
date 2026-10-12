// Adopted from shadcn-dashboard-landing-template (vite-version) `src/config/routes.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import type { ComponentType } from "react"
import { Navigate, type RouteObject } from "react-router-dom"

import { KeepSearch } from "@/components/router/keep-search"
import { RootErrorBoundary, RootFallback, RootLayout } from "@/components/router/root-layout"

/**
 * Every page is code-split. With the data router, a route's code is loaded
 * *before* the navigation commits: the current page stays on screen and the
 * root layout shows a progress bar until the next page is ready.
 */
function page(load: () => Promise<{ default: ComponentType }>) {
  return async () => ({ Component: (await load()).default })
}

export const routes: RouteObject[] = [
  // Relative target ("dispatch", not "/dispatch") keeps a deployment basename working
  { path: "/", element: <Navigate to="dispatch" replace /> },
  // Workshop
  { path: "/dispatch", lazy: page(() => import("@/app/dispatch/page")) },
  { path: "/appointments", lazy: page(() => import("@/app/appointments/page")) },
  // Resources, the admin area: its layout mounts Refine core, so only this subtree loads it (ADR-027, ADR-028)
  {
    path: "/resources",
    lazy: page(() => import("@/app/admin/layout")),
    children: [
      { index: true, element: <KeepSearch to="technicians" /> },
      { path: "technicians", lazy: page(() => import("@/app/admin/technicians/page")) },
      { path: "bays", lazy: page(() => import("@/app/admin/bays/page")) },
      { path: "services", lazy: page(() => import("@/app/admin/services/page")) },
    ],
  },
  // Settings
  { path: "/settings", element: <KeepSearch to="appearance" /> },
  { path: "/settings/appearance", lazy: page(() => import("@/app/settings/appearance/page")) },
  { path: "/settings/account", lazy: page(() => import("@/app/settings/account/page")) },
  // Error pages, routed so the app can send the user to one (lib/error-pages)
  { path: "/errors/unauthorized", lazy: page(() => import("@/app/errors/unauthorized/page")) },
  { path: "/errors/forbidden", lazy: page(() => import("@/app/errors/forbidden/page")) },
  { path: "/errors/not-found", lazy: page(() => import("@/app/errors/not-found/page")) },
  { path: "/errors/internal-server-error", lazy: page(() => import("@/app/errors/internal-server-error/page")) },
  { path: "/errors/under-maintenance", lazy: page(() => import("@/app/errors/under-maintenance/page")) },
  // Catch-all route for 404
  { path: "*", lazy: page(() => import("@/app/errors/not-found/page")) },
]

/** The whole route tree: the root layout (progress bar, error boundary) around the pages. */
export const appRoutes: RouteObject[] = [
  {
    element: <RootLayout />,
    HydrateFallback: RootFallback,
    errorElement: <RootErrorBoundary />,
    children: routes,
  },
]
