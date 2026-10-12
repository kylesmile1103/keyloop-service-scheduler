import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * The README's licence section promises that every file adapted from the MIT shadcn-dashboard-landing-template names its
 * template source and carries the template's copyright in a header comment. A source file that speaks of the template
 * (because it was adopted from it) must open with that header. Tests and the generated API client are not adopted code.
 */
const src = import.meta.dirname
const read = (file: string) => readFileSync(path.join(src, file), "utf8")

const sources = readdirSync(src, { recursive: true, encoding: "utf8" })
  .filter((file) => /\.(tsx?|css)$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.startsWith(`api${path.sep}`))
  .sort()
const adopted = sources.filter((file) => /\btemplate\b/i.test(read(file)))

/** The file's opening comment as one line of words (`//`, `/*` and ` *` prefixes dropped); `null` without one. */
function openingComment(text: string): string | null {
  const match = /^(?:\/\/[^\n]*\n)+|^\/\*[\s\S]*?\*\//.exec(text)
  if (!match) return null
  return match[0]
    .replace(/^\s*(?:\/\/|\/\*+|\*\/|\*)[ \t]?/gm, "")
    .replace(/\*\/$/, "")
    .replace(/\s+/g, " ")
    .trim()
}

describe("template attribution", () => {
  it("finds the adopted files, the moved data table parts and the error pages among them", () => {
    expect(adopted).toEqual(
      expect.arrayContaining(
        [
          "components/data-table/data-table-column-header.tsx",
          "components/data-table/data-table-pagination.tsx",
          "components/data-table/data-table-view-options.tsx",
          "app/errors/forbidden/page.tsx",
          "app/errors/internal-server-error/page.tsx",
          "app/errors/not-found/page.tsx",
          "app/errors/unauthorized/page.tsx",
          "app/errors/under-maintenance/page.tsx",
          "app/admin/components/resource-page.tsx",
          "components/stat-card.tsx",
        ].map((file) => path.join(...file.split("/")))
      )
    )
  })

  it.each(adopted)("%s opens with its template source and the template's MIT copyright", (file) => {
    const header = openingComment(read(file))

    expect(header).toMatch(/^Adopted from shadcn-dashboard-landing-template \(vite-version\) `src\/[^`]+`/)
    expect(header).toContain("Copyright (c) 2025 ShadcnStore, MIT License")
  })
})
