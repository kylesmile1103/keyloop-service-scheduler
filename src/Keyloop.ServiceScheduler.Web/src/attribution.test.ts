import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * The README's licence section promises that every file adopted from the MIT shadcn-dashboard-landing-template (vite
 * version) opens with a header comment naming its template source and carrying the template's copyright; the vendored
 * `components/ui` primitives also carry shadcn/ui's. This is the list of those files, kept by hand and independent of what
 * the files say about themselves, so removing a header (or a file) fails here. Paths are relative to the web project; each
 * maps to the template file or files it came from (relative to the template's `vite-version` folder).
 *
 * Found by provenance (the scaffold commit copied the template's shell, configuration and primitives), by what the
 * commits and the files declare adopted, and by comparing every source file with the template's. Not on the list:
 * `package.json` and `components.json`, whose JSON has no comment syntax (the README's notice covers them), tests, the
 * generated `src/api` client and the project's own files.
 */
const ADOPTED: Record<string, readonly string[]> = {
  // Configuration
  "eslint.config.js": ["eslint.config.js"],
  "index.html": ["index.html"],
  "tsconfig.json": ["tsconfig.json"],
  "tsconfig.app.json": ["tsconfig.app.json"],
  "tsconfig.node.json": ["tsconfig.node.json"],
  "vite.config.ts": ["vite.config.ts"],

  // Application shell, routes, theme and hooks
  "src/App.tsx": ["src/App.tsx"],
  "src/main.tsx": ["src/main.tsx"],
  "src/index.css": ["src/index.css"],
  "src/vite-env.d.ts": ["src/vite-env.d.ts"],
  "src/config/routes.tsx": ["src/config/routes.tsx"],
  "src/contexts/theme-context.ts": ["src/contexts/theme-context.ts"],
  "src/components/app-sidebar.tsx": ["src/components/app-sidebar.tsx"],
  "src/components/circular-transition.css": ["src/components/theme-customizer/circular-transition.css"],
  "src/components/layouts/base-layout.tsx": ["src/components/layouts/base-layout.tsx"],
  "src/components/logo.tsx": ["src/components/logo.tsx"],
  "src/components/mode-toggle.tsx": ["src/components/mode-toggle.tsx"],
  "src/components/nav-main.tsx": ["src/components/nav-main.tsx"],
  "src/components/nav-user.tsx": ["src/components/nav-user.tsx"],
  "src/components/router/root-layout.tsx": [
    "src/components/router/root-layout.tsx",
    "src/app/errors/internal-server-error/components/internal-server-error.tsx",
  ],
  "src/components/site-header.tsx": ["src/components/site-header.tsx"],
  "src/components/theme-provider.tsx": ["src/components/theme-provider.tsx"],
  "src/hooks/use-circular-transition.ts": ["src/hooks/use-circular-transition.ts"],
  "src/hooks/use-media-query.ts": ["src/hooks/use-mobile.ts"],
  "src/hooks/use-mobile.ts": ["src/hooks/use-mobile.ts"],
  "src/hooks/use-theme.ts": ["src/hooks/use-theme.ts"],
  "src/lib/utils.ts": ["src/lib/utils.ts"],

  // Vendored primitives (shadcn/ui, Base UI style, as the template ships them)
  ...Object.fromEntries(
    [
      "alert",
      "avatar",
      "badge",
      "button",
      "calendar",
      "card",
      "checkbox",
      "collapsible",
      "dialog",
      "dropdown-menu",
      "field",
      "input",
      "kbd",
      "label",
      "loading-spinner",
      "popover",
      "scroll-area",
      "select",
      "separator",
      "sheet",
      "sidebar",
      "skeleton",
      "switch",
      "table",
      "tabs",
      "textarea",
      "toast",
      "tooltip",
    ].map((name) => [`src/components/ui/${name}.tsx`, [`src/components/ui/${name}.tsx`]])
  ),

  // Data table parts and stat card (tasks and users apps)
  "src/lib/data-table.ts": ["src/lib/data-table.ts"],
  "src/components/data-table/data-table-column-header.tsx": ["src/app/tasks/components/data-table-column-header.tsx"],
  "src/components/data-table/data-table-faceted-filter.tsx": ["src/app/tasks/components/data-table-faceted-filter.tsx"],
  "src/components/data-table/data-table-pagination.tsx": ["src/app/tasks/components/data-table-pagination.tsx"],
  "src/components/data-table/data-table-toolbar.tsx": ["src/app/tasks/components/data-table-toolbar.tsx"],
  "src/components/data-table/data-table-view-options.tsx": ["src/app/tasks/components/data-table-view-options.tsx"],
  "src/components/stat-card.tsx": ["src/app/users/components/stat-cards.tsx"],

  // Dispatch board (dashboard and calendar apps; the booking dialog also the users app's form dialog)
  "src/app/dispatch/components/booking-dialog.tsx": [
    "src/app/calendar/components/event-form.tsx",
    "src/app/users/components/user-form-dialog.tsx",
  ],
  "src/app/dispatch/components/date-navigator.tsx": ["src/app/calendar/components/date-picker.tsx"],
  "src/app/dispatch/components/filters-sheet.tsx": ["src/app/calendar/components/calendar.tsx"],
  "src/app/dispatch/components/kpi-strip.tsx": [
    "src/app/dashboard/components/section-cards.tsx",
    "src/app/dashboard-2/components/metrics-overview.tsx",
  ],
  "src/app/dispatch/components/lane-filter.tsx": [
    "src/app/calendar/components/calendars.tsx",
    "src/app/calendar/components/calendar-sidebar.tsx",
  ],
  "src/app/dispatch/components/schedule-agenda.tsx": ["src/app/calendar/components/calendar-main.tsx"],

  // Appointments list (tasks app's data table, users app's stat cards)
  "src/app/appointments/components/appointments-table.tsx": ["src/app/tasks/components/data-table.tsx"],
  "src/app/appointments/components/columns.tsx": ["src/app/tasks/components/columns.tsx"],
  "src/app/appointments/components/data-table-row-actions.tsx": ["src/app/tasks/components/data-table-row-actions.tsx"],
  "src/app/appointments/components/stat-cards.tsx": ["src/app/users/components/stat-cards.tsx"],

  // Resources (users app)
  "src/app/admin/components/resource-page.tsx": ["src/app/users/page.tsx"],
  "src/app/admin/components/resource-table.tsx": ["src/app/users/components/data-table.tsx"],
  "src/app/admin/technicians/columns.tsx": ["src/app/users/components/data-table.tsx"],
  "src/app/admin/technicians/technician-figures.tsx": ["src/app/users/components/stat-cards.tsx"],
  "src/app/admin/bays/columns.tsx": ["src/app/users/components/data-table.tsx"],
  "src/app/admin/bays/bay-figures.tsx": ["src/app/users/components/stat-cards.tsx"],
  "src/app/admin/services/columns.tsx": ["src/app/users/components/data-table.tsx"],
  "src/app/admin/services/service-figures.tsx": ["src/app/users/components/stat-cards.tsx"],

  // Settings (settings app)
  "src/app/settings/account/page.tsx": ["src/app/settings/account/page.tsx"],
  "src/app/settings/appearance/page.tsx": ["src/app/settings/appearance/page.tsx"],

  // Error pages (errors app)
  "src/app/errors/components/error-page.tsx": ["src/app/errors/*/components/*-error.tsx"],
  "src/app/errors/forbidden/page.tsx": ["src/app/errors/forbidden/components/forbidden-error.tsx"],
  "src/app/errors/internal-server-error/page.tsx": [
    "src/app/errors/internal-server-error/components/internal-server-error.tsx",
  ],
  "src/app/errors/not-found/page.tsx": ["src/app/errors/not-found/components/not-found-error.tsx"],
  "src/app/errors/unauthorized/page.tsx": ["src/app/errors/unauthorized/components/unauthorized-error.tsx"],
  "src/app/errors/under-maintenance/page.tsx": [
    "src/app/errors/under-maintenance/components/under-maintenance-error.tsx",
  ],
}

const web = path.resolve(import.meta.dirname, "..")
const read = (file: string) => readFileSync(path.join(web, ...file.split("/")), "utf8")

/** The project's own code: the web project's top-level configuration and every source file, without tests or `src/api`. */
const sources = [
  ...readdirSync(web).filter((file) => /\.(tsx?|js|html|json)$/.test(file)),
  ...readdirSync(path.join(web, "src"), { recursive: true, encoding: "utf8" }).map(
    (file) => `src/${file.split(path.sep).join("/")}`
  ),
]
  .filter((file) => /\.(tsx?|js|css|html|json)$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.startsWith("src/api/"))
  .sort()

/** The file's opening comment as one line of words (comment markers dropped), after an HTML doctype; `null` without one. */
function openingComment(text: string): string | null {
  const body = text.replace(/^<!doctype html>\s*/i, "")
  const match = /^(?:\/\/[^\n]*\n)+|^\/\*[\s\S]*?\*\/|^<!--[\s\S]*?-->/.exec(body)
  if (!match) return null
  return match[0]
    .replace(/^<!--|-->$/g, "")
    .replace(/^\s*(?:\/\/|\/\*+|\*\/|\*)[ \t]?/gm, "")
    .replace(/\*\/$/, "")
    .replace(/\s+/g, " ")
    .trim()
}

describe("template attribution", () => {
  it.each(Object.entries(ADOPTED))("%s opens with its template source and the template's MIT copyright", (file, from) => {
    const header = openingComment(read(file))

    expect(header).toMatch(/^Adopted from shadcn-dashboard-landing-template \(vite-version\) `/)
    for (const source of from) expect(header).toContain(`\`${source}\``)
    expect(header).toContain("Copyright (c) 2025 ShadcnStore, MIT License")
    if (file.startsWith("src/components/ui/")) expect(header).toContain("Copyright (c) 2023 shadcn, MIT License")
  })

  it("lists every vendored primitive", () => {
    const primitives = sources.filter((file) => file.startsWith("src/components/ui/"))

    expect(primitives.length).toBeGreaterThan(0)
    expect(primitives.filter((file) => !(file in ADOPTED))).toEqual([])
  })

  it("lists every file that refers to the template", () => {
    const referring = sources.filter((file) => /\btemplate\b/i.test(read(file)))

    expect(referring.length).toBeGreaterThan(0)
    expect(referring.filter((file) => !(file in ADOPTED))).toEqual([])
  })
})
