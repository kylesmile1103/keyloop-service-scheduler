import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

// Read from disk: Vitest stubs CSS imports (even `?raw`) to an empty string.
const css = readFileSync(path.resolve(import.meta.dirname, "index.css"), "utf8")

// Appointment states (SYSTEM_DESIGN §5.5) and their token slugs (Addendum B §B4).
const statuses = ["confirmed", "checked-in", "in-progress", "completed", "no-show", "cancelled"] as const
const themes = [
  { name: "light", selector: ":root" },
  { name: "dark", selector: ".dark" },
] as const

function block(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)
  if (!match) throw new Error(`${selector} block not found in index.css`)
  return Object.fromEntries([...match[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}

/** CSS `oklch(L C h)` → relative luminance (WCAG 2.2), via OKLab and linear sRGB, clipped to the sRGB gamut. */
function luminance(value: string): number {
  const match = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value)
  if (!match) throw new Error(`expected an opaque oklch() colour, got "${value}"`)
  const lightness = Number(match[1]) / (match[2] ? 100 : 1)
  const chroma = Number(match[3])
  const hue = (Number(match[4]) * Math.PI) / 180
  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)

  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3

  const clip = (x: number) => Math.min(1, Math.max(0, x))
  const red = clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const green = clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const blue = clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

describe("contrast helper", () => {
  it("matches WCAG reference values: black/white 21:1, #636363/white 6.0:1, #ff0000/white 4.0:1", () => {
    expect(contrast("oklch(0 0 0)", "oklch(1 0 0)")).toBeCloseTo(21, 1)
    expect(contrast("oklch(0.5 0 0)", "oklch(1 0 0)")).toBeCloseTo(6.0, 1)
    expect(contrast("oklch(0.62796 0.25768 29.2339)", "oklch(1 0 0)")).toBeCloseTo(4.0, 1)
  })
})

describe.each(themes)("appointment status tokens in the $name theme", ({ selector }) => {
  const tokens = block(selector)

  it.each(statuses)("%s label text on its tint reaches WCAG AA (4.5:1)", (status) => {
    expect(contrast(tokens[`status-${status}-fg`], tokens[`status-${status}-bg`])).toBeGreaterThanOrEqual(4.5)
  })

  it.each(statuses)("%s marker stands out from the card surface (3:1 non-text contrast)", (status) => {
    expect(contrast(tokens[`status-${status}-border`], tokens.card)).toBeGreaterThanOrEqual(3)
  })
})

describe("Tailwind exposure", () => {
  it.each(statuses)("maps the %s tokens to bg-, border- and text- utilities", (status) => {
    for (const part of ["bg", "border", "fg"]) {
      expect(css).toContain(`--color-status-${status}-${part}: var(--status-${status}-${part});`)
    }
  })
})
