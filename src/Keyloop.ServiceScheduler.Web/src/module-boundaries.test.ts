import { ESLint } from "eslint"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The admin area (src/app/admin: Refine and the resources pages) and the workshop pages (dispatch, calendar, overview,
 * appointments) never import each other, so the board's first load never downloads Refine or admin code. Both may use
 * components, hooks, lib and api. ESLint enforces it; these cases pin the rule to the real configuration.
 */
const eslint = new ESLint({ cwd: path.resolve(import.meta.dirname, "..") })

async function boundaryErrors(file: string, specifier: string): Promise<string[]> {
  const [result] = await eslint.lintText(`import { thing } from "${specifier}"\n\nexport const used = thing\n`, { filePath: file })
  return result.messages.filter((message) => message.ruleId === "no-restricted-imports").map((message) => message.message)
}

describe("module boundary between the workshop pages and the admin area", () => {
  it.each([
    ["src/app/admin/technicians/page.tsx", "@/app/dispatch/lib/status"],
    ["src/app/admin/technicians/page.tsx", "@/app/appointments/lib/appointments"],
    ["src/app/admin/lib/data-provider.ts", "../../dispatch/hooks/use-board-params"],
    ["src/app/admin/components/resource-table.tsx", "../../appointments/components/columns"],
    ["src/app/admin/layout.tsx", "@/app/calendar/page"],
    ["src/app/admin/layout.tsx", "@/app/overview/page"],
  ])("refuses %s importing %s", async (file, specifier) => {
    expect(await boundaryErrors(file, specifier)).toEqual([expect.stringContaining("The admin area may not import a workshop page")])
  })

  it.each([
    ["src/app/dispatch/page.tsx", "@/app/admin/lib/data-provider"],
    ["src/app/appointments/page.tsx", "@/app/admin"],
    ["src/app/dispatch/components/kpi-strip.tsx", "../../admin/lib/resources"],
    ["src/app/appointments/lib/appointments.ts", "../../admin/technicians/page"],
    ["src/app/calendar/page.tsx", "@/app/admin/layout"],
    ["src/app/overview/page.tsx", "../admin/lib/resources"],
  ])("refuses %s importing %s", async (file, specifier) => {
    expect(await boundaryErrors(file, specifier)).toEqual([expect.stringContaining("The workshop pages may not import the admin area")])
  })

  it.each([
    ["src/app/admin/technicians/page.tsx", "@/components/ui/button"],
    ["src/app/admin/technicians/page.tsx", "@/components/data-table/data-table-toolbar"],
    ["src/app/admin/technicians/page.tsx", "@/hooks/use-selected-dealership"],
    ["src/app/admin/technicians/page.tsx", "@/lib/booked-time"],
    ["src/app/admin/technicians/page.tsx", "@/api/@tanstack/react-query.gen"],
    ["src/app/admin/technicians/page.tsx", "../lib/resources"],
    ["src/app/dispatch/page.tsx", "@/components/capability-badges"],
    ["src/app/appointments/page.tsx", "@/app/dispatch/lib/status"],
    ["src/config/routes.tsx", "@/app/admin/layout"],
  ])("lets %s import %s", async (file, specifier) => {
    expect(await boundaryErrors(file, specifier)).toEqual([])
  })
})
