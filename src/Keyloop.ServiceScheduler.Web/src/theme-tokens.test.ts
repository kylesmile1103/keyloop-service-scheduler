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

type Rgb = readonly [number, number, number]

/** CSS `oklch(L C h)` → linear sRGB, via OKLab (CSS Color 4 matrices), clipped to the sRGB gamut. */
function linearRgb(value: string): Rgb {
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
  return [
    clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

const encode = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)
const decode = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)

/** Relative luminance (WCAG 2.2) of linear sRGB channels. */
const relativeLuminance = ([red, green, blue]: Rgb) => 0.2126 * red + 0.7152 * green + 0.0722 * blue

function luminance(value: string): number {
  return relativeLuminance(linearRgb(value))
}

function ratio(first: number, second: number): number {
  const [light, dark] = [first, second].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

function contrast(foreground: string, background: string): number {
  return ratio(luminance(foreground), luminance(background))
}

/**
 * A colour at `percent` opacity painted over an opaque one, as the browser composites Tailwind's `x/NN` (gamma-encoded sRGB).
 * Returns linear sRGB.
 */
function over(top: string, percent: number, bottom: string): Rgb {
  const alpha = percent / 100
  const [t, b] = [linearRgb(top), linearRgb(bottom)]
  return [0, 1, 2].map((i) => decode(alpha * encode(t[i]) + (1 - alpha) * encode(b[i]))) as unknown as Rgb
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

/**
 * Contrast-critical pairs from docs/DESIGN_SYSTEM.md section 4.4 (text 4.5:1; control boundaries, focus indicators and marks
 * 3:1), asserted in both themes. `token/NN` is the token at NN % opacity composited over the pair's background, as
 * Tailwind's opacity modifier paints it. Rows marked with a theme occur only in that theme.
 */
const pairs: ReadonlyArray<readonly [foreground: string, background: string, minimum: number, only?: "light" | "dark"]> = [
  // Core text
  ["foreground", "background", 4.5],
  ["foreground", "card", 4.5],
  ["foreground", "popover", 4.5],
  ["foreground", "muted", 4.5],
  ["foreground", "secondary", 4.5],
  ["foreground", "accent", 4.5],
  ["muted-foreground", "background", 4.5],
  ["muted-foreground", "card", 4.5],
  ["muted-foreground", "popover", 4.5],
  ["muted-foreground", "muted", 4.5],
  ["muted-foreground", "secondary", 4.5],
  ["muted-foreground", "accent", 4.5],
  ["muted-foreground", "sidebar", 4.5],
  // The secondary line of a hovered or open nav item (the user row): 4.49:1 before the v2 correction.
  ["muted-foreground", "sidebar-accent", 4.5],
  ["secondary-foreground", "secondary", 4.5],
  ["accent-foreground", "accent", 4.5],
  ["card-foreground", "card", 4.5],
  ["popover-foreground", "popover", 4.5],
  // Actions
  ["primary-foreground", "primary", 4.5],
  // The selected slot chip's capacity line and an active pill's count (muted text there was 3.06:1 light, 1.88:1 dark).
  ["primary-foreground/80", "primary", 4.5],
  ["signal", "background", 4.5],
  ["signal", "card", 4.5],
  ["signal", "popover", 4.5],
  ["signal", "muted", 4.5],
  ["signal-foreground", "signal", 4.5],
  ["brand-accent-foreground", "brand-accent", 4.5],
  ["destructive-foreground", "destructive", 4.5],
  // Feedback: ink on a card and on its own banner tint, text on a solid fill, body text in the banner
  ...(["success", "warning", "info", "destructive"] as const).flatMap((tone) => [
    [tone, "card", 4.5] as const,
    [tone, "background", 4.5] as const,
    [tone, `${tone}-subtle`, 4.5] as const,
    ["foreground", `${tone}-subtle`, 4.5] as const,
    ["muted-foreground", `${tone}-subtle`, 4.5] as const,
  ]),
  ["success-foreground", "success", 4.5],
  ["warning-foreground", "warning", 4.5],
  ["info-foreground", "info", 4.5],
  // Sidebar
  ["sidebar-foreground", "sidebar", 4.5],
  ["sidebar-accent-foreground", "sidebar-accent", 4.5],
  ["sidebar-primary-foreground", "sidebar-primary", 4.5],
  // Focus indicators
  ...(["background", "card", "popover", "muted", "secondary", "accent", "sidebar", "sidebar-accent"] as const).map(
    (surface) => ["ring", surface, 3] as const
  ),
  // Control boundaries: fields, selects, checkboxes, chips, outline buttons (the dark field border on the menu highlight was
  // 2.97:1 before the v2 correction), and the plate chip's outline on every status tint
  ...(["background", "card", "popover", "muted", "secondary", "accent", "sidebar"] as const).map(
    (surface) => ["input", surface, 3] as const
  ),
  ...statuses.map((status) => ["input", `status-${status}-bg`, 3] as const),
  // Marks
  ["signal", "background", 3],
  ["brand-accent", "background", 3],
  ["primary", "background", 3],
  ["destructive", "card", 3],
  ["chart-1", "card", 3],
  ["chart-2", "card", 3],
  ["chart-3", "card", 3],
  ["chart-4", "card", 3],
  ["chart-5", "card", 3],
  ["chart-1", "muted", 3],
  ["background", "signal", 3],
]

describe.each(themes)("design-system pairs in the $name theme", ({ name, selector }) => {
  const tokens = { ...block(":root"), ...block(selector) }
  const value = (token: string) => {
    if (!tokens[token]) throw new Error(`--${token} is not defined for the ${name} theme`)
    return tokens[token]
  }

  const rows = pairs
    .filter(([, , , only]) => !only || only === name)
    .map(([foreground, background, minimum]) => ({ foreground, background, minimum }))

  it.each(rows)("$foreground on $background reaches $minimum:1", ({ foreground, background, minimum }) => {
    const translucent = /^(.+)\/(\d+)$/.exec(foreground)
    const measured = translucent
      ? ratio(relativeLuminance(over(value(translucent[1]), Number(translucent[2]), value(background))), luminance(value(background)))
      : contrast(value(foreground), value(background))
    expect(measured).toBeGreaterThanOrEqual(minimum)
  })
})

describe("compositing helper", () => {
  it("composites on gamma-encoded values, as browsers do: white at 50 % over black is mid grey, not 50 % luminance", () => {
    // Encoded 0.5 (#808080 after rounding) is linear 0.214; blending linear values would give 0.5.
    expect(relativeLuminance(over("oklch(1 0 0)", 50, "oklch(0 0 0)"))).toBeCloseTo(0.214, 2)
  })
})
