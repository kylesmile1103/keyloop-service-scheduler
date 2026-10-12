# Service Scheduler UI design

The visual and interaction rules for the dispatch-board web app (`src/Keyloop.ServiceScheduler.Web`). The tokens live in `src/index.css` (applied from `keyloop-theme.css`); this document says what each token is for and how the components use them. When this document and a component disagree, fix the component.

**Key decisions at a glance**

| Decision | Light | Dark |
|---|---|---|
| App frame (sidebar and surround) | Keyloop website grey `#f1f1f3` | carbon, one step deeper `#0b1115` |
| Work surface (`--background`) and cards | white | carbon `#11181c` and deep graphite `#162228` |
| Text (`--foreground`) | Keyloop navy `#1e2e3d` | website grey `#f1f1f3` |
| Primary action (`--primary`) | carbon `#11181c`, white text | website grey `#f1f1f3`, carbon text (Keyloop's white-on-dark button) |
| Interaction colour (`--signal`, `--ring`) | signal blue deepened to `#0068b7` (text) and `#0083e0` (focus ring) | Keyloop signal blue `#3da5ff` |
| Brand accent (`--brand-accent`) | cyan deepened to `#009dbc`, carbon text | Keyloop cyan `#00b5d8`, carbon text |
| Signature | the Fusion **OWNERSHIP** domain gradient (`#b39cf3 → #cda4b2 → #e6ac74`), used once, in the header tag | same |
| Type | Plus Jakarta Sans (headings, figures), IBM Plex Sans (UI, body), IBM Plex Mono (VIN, registration, trace id) | same |
| Shape | 6 px controls, 8 px chips, 12 px cards, 16 px toasts and sheets, pills full | same |

---

## 1. Purpose and provenance

This is the design system for a candidate's take-home demo (the Keyloop Principal Engineer assessment, Scenario A). It is **inspired by Keyloop's public web design language** so the dispatch board feels at home next to Keyloop's own products. It is not an official Keyloop asset and must not be presented as one.

- **Sources.** Scraped on 2026-10-12 with Claude in Chrome from `keyloop.com` (home, `/fusion-arp`, `/service-hub`, `/product-overview`), `drivetime.keyloop.com` and `trust.keyloop.com`, at 1440 × 900 and 390 × 844. Computed styles, the WordPress `theme.json` preset variables (`--wp--preset--color--brand-*`) and screenshots. Raw notes: `keyloop-brand-research.md` (kept with the design working files).
- **What we took.** Keyloop's colour names and values, the four Fusion domain gradients, the type pairing (Plus Jakarta Sans with IBM Plex Sans), radii, shadow softness, button shapes, and Service Hub's product patterns: job cards, the plate chip, the initials avatar, status icon tiles, the signal-blue segmented toggle and the traffic-light outcome legend (section 11.17).
- **What we did not take.** No Keyloop logo, logo glyph, photography or product imagery. The wordmark is the plain text **Keyloop** set in Plus Jakarta Sans. The app's own glyph (`src/components/logo.tsx`, three lane bars and a "now" line) is ours. The illustrations in section 12 are original artwork generated for this project with OpenAI image generation through Codex (prompts and provenance in the images README kept with the design working files; the alt text is repeated in section 12.4). Two Service Hub patterns are deliberately left out: the dark carbon app bar (section 11.1) and the circle-arrow "Learn more" icon (section 5.2).
- **Provenance in the app, too.** The running app says what it is: the sidebar footer reads "Take-home demo · inspired by Keyloop's public design language · not an official Keyloop product" (section 11.1), so a screenshot or a video frame cannot pass for a Keyloop product.
- **Fonts.** All three families are open source (SIL Open Font License 1.1) and self-hosted from npm (`@fontsource`). No request leaves the app for fonts, and no font is inlined as a `data:` URI, which the production CSP (`font-src 'self'`) would block (section 17.1, step 4).
- **Where Keyloop's own colours fail accessibility**, this theme keeps the hue and corrects the lightness. Section 3.4 lists every case.

## 2. Design principles

1. **Calm canvas, dense work surfaces.** The frame and page are quiet greys and white (carbon and graphite in dark). Density lives inside cards: the timeline, the agenda, tables. Colour is reserved for appointment state and feedback, so a glance at the board reads as a status map (Addendum B §B4, "calm control room").
2. **Status at a glance, never by colour alone.** Every appointment status has a hue, an icon and a word. The hue tells you where to look; the icon and the label tell you what it is, for every reader.
3. **One primary action per view.** A view has at most one carbon (light) or white (dark) button. On the board it is **Book appointment**. Everything else is secondary, signal outline, ghost, or a link. The cyan accent is not a second primary: it appears only on the mobile floating Book action and on the toast action.
4. **Dark mode parity.** Every screen, state and token exists in both themes and passes the same contrast audit (section 4.4). Dark is designed, not inverted: surfaces step up in lightness as they come forward (frame, page, card, popover) and shadows give way to borders.
5. **Mobile-first agenda.** On a phone the board is an agenda of job cards, not a squeezed grid; dialogs become full-screen sheets; every target is at least 44 × 44 px (section 14).
6. **The brand shows in one place.** The OWNERSHIP gradient tag in the header is the signature. Do not spread gradients across cards, buttons or charts.

## 3. Brand palette

### 3.1 Keyloop colours and our names

Keyloop's own token names (`--wp--preset--color--brand-*` on keyloop.com) map to `--kl-*` custom properties in `:root`. They are **reference values**: they feed the semantic tokens and the domain gradients. Components never use `--kl-*` directly (the one exception is the domain tag's carbon text, inside `.domain-tag`).

| Keyloop token | Our token | Hex | oklch | Used for |
|---|---|---|---|---|
| `brand-carbonblack` | `--kl-carbon-black` | `#11181c` | `oklch(0.204 0.013 233.3)` | `--primary` (light), `--background` (dark), primary text on light fills, domain-tag text |
| `brand-deepgraphite` | `--kl-deep-graphite` | `#162228` | `oklch(0.244 0.02 230.3)` | `--card` (dark) |
| `brand-navy / brand-foreground` | `--kl-navy` | `#1e2e3d` | `oklch(0.294 0.035 247.5)` | `--foreground` (light), `--secondary` (dark) |
| `brand-techslate` | `--kl-tech-slate` | `#2e4758` | `oklch(0.385 0.042 239)` | illustration shading only |
| `brand-foregroundsecondary` | `--kl-slate` | `#4a5568` | `oklch(0.447 0.034 261.3)` | reference; `--muted-foreground` sits between this and slate-muted |
| `brand-mutedforeground` | `--kl-slate-muted` | `#718096` | `oklch(0.596 0.038 257.9)` | not used for text (fails AA); corrected as `--muted-foreground` |
| `brand-uiborder` | `--kl-ui-border` | `#d9e0e4` | `oklch(0.903 0.009 232.4)` | `--border` (light) |
| `brand-websitegrey` | `--kl-website-grey` | `#f1f1f3` | `oklch(0.959 0.003 286.3)` | `--sidebar` frame and `--muted` (light), `--foreground` and `--primary` (dark) |
| `brand-backgroundsecondary` | `--kl-background-secondary` | `#f5f9fa` | `oklch(0.979 0.004 214.3)` | reference only |
| `brand-cyan` | `--kl-cyan` | `#00b5d8` | `oklch(0.7138 0.1285 218.27)` | `--brand-accent` (dark); deepened for light |
| `brand-fusionblue` | `--kl-fusion-blue` | `#00c7f2` | `oklch(0.768 0.141 220.8)` | checked-in marker (dark, lifted) |
| `brand-signalblue` | `--kl-signal-blue` | `#3da5ff` | `oklch(0.704 0.162 248.7)` | `--signal`, `--ring`, `--info` (dark); deepened for light |
| `brand-fusionpurple` | `--kl-fusion-purple` | `#5f7cff` | `oklch(0.633 0.196 270.5)` | confirmed status marker |
| `brand-hyperviolet` | `--kl-hyper-violet` | `#8b5cf6` | `oklch(0.606 0.219 292.7)` | `--chart-3` |
| `brand-energycoral / fusioncoral` | `--kl-energy-coral` | `#ff6b57` | `oklch(0.708 0.185 30.1)` | `--chart-5` |
| `brand-pulsegreen / success` | `--kl-pulse-green` | `#18e0a4` | `oklch(0.8047 0.1662 164.93)` | `--success` (dark); deepened for light |
| `brand-warning` | `--kl-amber` | `#ffb800` | `oklch(0.827 0.171 80.5)` | `--warning` and in-progress marker (dark); deepened for light |
| `brand-error` | `--kl-red` | `#ff4d4f` | `oklch(0.673 0.214 24.5)` | `--destructive` source; deepened (light) and lifted (dark) |

Keyloop also uses a Tailwind-like grey ramp for body copy (`#111827`, `#374151`); this theme replaces it with the navy and slate tokens above so text and surfaces share one cool hue family.

### 3.2 How the palette divides the work

- **Neutrals** (carbon, graphite, navy, slate, website grey, UI border): surfaces, text, borders. About 90 % of every screen.
- **Signal blue**: interaction. Links, the signal outline button, selected indicators (active tab bar, active nav bar), focus rings, info feedback.
- **Cyan**: the brand accent, for the floating Book action and the toast action only.
- **Status hues** (fusion purple, sky, amber, green, rose, slate): appointment state only (section 4.3).
- **Feedback** (green, amber, red): outcomes of actions.
- **OWNERSHIP gradient**: the domain tag in the header. Nothing else.

### 3.3 Fusion domain gradients

Keyloop's Fusion platform labels each business domain with a gradient badge: uppercase, 0.2 em letter-spacing, weight 600, 8 px radius, carbon text, `linear-gradient(90deg, a, b 30%, c)`.

| Domain | Token | Stops | Meaning |
|---|---|---|---|
| DEMAND | `--domain-demand` | `#6c82dd → #35b0ee 30% → #00ddff` | sales and marketing |
| SUPPLY | `--domain-supply` | `#6c82dd → #908fe8 30% → #b39cf3` | inventory |
| **OWNERSHIP** | `--domain-ownership` | `#b39cf3 → #cda4b2 30% → #e6ac74` | **aftersales and service: Service Hub's domain, and this app's** |
| OPERATE | `--domain-operate` | `#479bad → #24c9c0 30% → #00f6d2` | back office and DMS |

OWNERSHIP is the app's signature: lavender into dusty rose into peach. The other three exist only so the tag component is complete; this app does not use them. The stops are written in `oklch()`, so browsers interpolate the gradient in Oklab (smoother midpoints than Keyloop's sRGB gradient, same end colours). Carbon text is 7.65:1 or more everywhere on the OWNERSHIP gradient (sampled at 401 points along the Oklab interpolation; the minimum is the lavender start), and 5.0:1 or more on the other three.

### 3.4 Where Keyloop's own pairs fail WCAG AA, and the correction

| Keyloop pair | Ratio | Needs | Verdict | This theme |
|---|---:|---:|---|---|
| White text on brand-cyan (accent CTA) (`#ffffff` on `#00b5d8`) | 2.44:1 | 4.5:1 | **fails** | Carbon text on cyan, and cyan deepened to `#009dbc` on light so the button edge also clears 3:1 |
| Signal blue text or outline on white (`#3da5ff` on `#ffffff`) | 2.62:1 | 4.5:1 | **fails** | `--signal` `#0068b7` on light (5.7:1); `#3da5ff` kept on dark |
| White text on signal blue (solid) (`#ffffff` on `#3da5ff`) | 2.62:1 | 4.5:1 | **fails** | `--signal-foreground` is white on the deeper light signal, carbon on dark |
| Muted foreground on white (`#718096` on `#ffffff`) | 4.02:1 | 4.5:1 | **fails** | `--muted-foreground` `#596676` (5.8:1 on white, 5.2:1 on website grey, 4.7:1 or more on every light fill, including a hovered nav item) |
| Muted foreground on website grey (`#718096` on `#f1f1f3`) | 3.56:1 | 4.5:1 | **fails** | as above |
| Fusion purple product links on white (`#5f7cff` on `#ffffff`) | 3.61:1 | 4.5:1 | **fails** | Links use `--signal` (signal blue is Keyloop's link and outline colour on light, research section 1). Fusion purple is not deepened into a link colour because its deepened value, `#3347b2`, is the Confirmed status ink, and a link must not read as a status. Fusion purple stays the Confirmed marker (3:1 rule). |
| Brand error text on white (`#ff4d4f` on `#ffffff`) | 3.27:1 | 4.5:1 | **fails** | `--destructive` `#bb061e` on light; lifted `#fd8a8c` on dark |
| Pulse green text on white (`#18e0a4` on `#ffffff`) | 1.72:1 | 4.5:1 | **fails** | `--success` `#007653` on light; `#18e0a4` kept on dark |
| Brand warning text on white (`#ffb800` on `#ffffff`) | 1.73:1 | 4.5:1 | **fails** | `--warning` `#9b540c` on light; `#ffb800` kept on dark |
| Signal blue focus halo on white (3:1 UI) (`#3da5ff` on `#ffffff`) | 2.62:1 | 3.0:1 | **fails** | `--ring` `#0083e0` (3.9:1) on light |
| Carbon text on brand-cyan (`#11181c` on `#00b5d8`) | 7.34:1 | 4.5:1 | passes | kept: this is the corrected accent pair |
| Carbon text on Trust Center button #76afdc (`#11181c` on `#76afdc`) | 7.63:1 | 4.5:1 | passes | not used |

The pattern: Keyloop's bright accents (cyan, signal blue, pulse green, amber, error red) are built for dark surfaces and large marketing type. On a light app surface with 14 px text they fail. The light theme keeps each hue and lowers its lightness until text clears 4.5:1 and marks clear 3:1; the dark theme uses Keyloop's original values, where they already pass. The one exception is fusion purple, which is not turned into a text colour at all: it is reserved for the Confirmed status.

## 4. Semantic tokens

Components use **only** these tokens, through Tailwind utilities (`bg-card`, `text-muted-foreground`, `border-input`, `ring-ring`, `bg-status-confirmed-bg`, ...). Hex values below are what each `oklch()` renders as.

### 4.1 Surfaces, text, actions, feedback, sidebar, charts

**Surfaces and text**

| Token | Light | Dark | Source and role |
|---|---|---|---|
| `--background` | `#ffffff` `oklch(1 0 0)` | `#11181c` `oklch(0.204 0.013 233.3)` | light: work surface (inset panel): white; dark: #11181c brand-carbonblack: work surface |
| `--foreground` | `#1e2e3d` `oklch(0.294 0.035 247.5)` | `#f1f1f3` `oklch(0.959 0.003 286.3)` | light: #1e2e3d brand-navy; dark: #f1f1f3 brand-websitegrey |
| `--card` | `#ffffff` `oklch(1 0 0)` | `#162228` `oklch(0.244 0.02 230.3)` | light: white; dark: #162228 brand-deepgraphite |
| `--card-foreground` | `#1e2e3d` `oklch(0.294 0.035 247.5)` | `#f1f1f3` `oklch(0.959 0.003 286.3)` | light: #1e2e3d brand-navy; dark: #f1f1f3 brand-websitegrey |
| `--popover` | `#ffffff` `oklch(1 0 0)` | `#1b2a32` `oklch(0.275 0.025 235)` | light: white; dark: graphite lifted towards navy |
| `--popover-foreground` | `#1e2e3d` `oklch(0.294 0.035 247.5)` | `#f1f1f3` `oklch(0.959 0.003 286.3)` | light: #1e2e3d brand-navy; dark: #f1f1f3 brand-websitegrey |
| `--secondary` | `#ebf0f3` `oklch(0.952 0.007 240)` | `#1e2e3d` `oklch(0.294 0.035 247.5)` | light: cool grey between brand-uiborder and brand-websitegrey; dark: #1e2e3d brand-navy |
| `--secondary-foreground` | `#1e2e3d` `oklch(0.294 0.035 247.5)` | `#f1f1f3` `oklch(0.959 0.003 286.3)` | light: #1e2e3d brand-navy; dark: #f1f1f3 brand-websitegrey |
| `--muted` | `#f1f1f3` `oklch(0.959 0.003 286.3)` | `#1b2831` `oklch(0.27 0.025 238)` | light: #f1f1f3 brand-websitegrey; dark: between deep graphite and navy |
| `--muted-foreground` | `#596676` `oklch(0.505 0.03 255)` | `#a2b4c3` `oklch(0.76 0.03 245)` | light: AA-corrected brand-mutedforeground (#718096 is 4.0:1 on white), 4.7:1 or more on every light fill; dark: slate, 4.7:1 or more on every dark surface and field fill |
| `--accent` | `#e3f1fd` `oklch(0.952 0.022 245)` | `#1e3548` `oklch(0.32 0.045 245)` | light: signal-blue mist: menu highlight and hover surface; dark: navy with a signal lift: menu highlight |
| `--accent-foreground` | `#1e2e3d` `oklch(0.294 0.035 247.5)` | `#f1f1f3` `oklch(0.959 0.003 286.3)` | light: #1e2e3d brand-navy; dark: #f1f1f3 brand-websitegrey |
| `--border` | `#d9e0e4` `oklch(0.903 0.009 232.4)` | `#293841` `oklch(0.33 0.025 237)` | light: #d9e0e4 brand-uiborder (decorative hairlines); dark: decorative hairlines |
| `--input` | `#7a8895` `oklch(0.62 0.025 245)` | `#6f828f` `oklch(0.595 0.03 240)` | control boundary, 3:1 or more on every surface, tint and highlight a control sits on |
| `--ring` | `#0083e0` `oklch(0.6 0.17 250)` | `#3da5ff` `oklch(0.704 0.162 248.7)` | light: signal blue deepened; dark: #3da5ff brand-signalblue. The focus colour and the default outline colour, 3:1 or more on every surface |

**Actions**

| Token | Light | Dark | Source and role |
|---|---|---|---|
| `--primary` | `#11181c` `oklch(0.204 0.013 233.3)` | `#f1f1f3` `oklch(0.959 0.003 286.3)` | light: #11181c brand-carbonblack: primary buttons; dark: #f1f1f3 brand-websitegrey: white-on-dark primary, as on keyloop.com |
| `--primary-foreground` | `#ffffff` `oklch(1 0 0)` | `#11181c` `oklch(0.204 0.013 233.3)` | light: white; dark: #11181c brand-carbonblack |
| `--signal` | `#0068b7` `oklch(0.51 0.15 250)` | `#3da5ff` `oklch(0.704 0.162 248.7)` | light: AA-corrected brand-signalblue: links, outline buttons, selected indicators; dark: #3da5ff brand-signalblue |
| `--signal-foreground` | `#ffffff` `oklch(1 0 0)` | `#11181c` `oklch(0.204 0.013 233.3)` | light: white; dark: #11181c brand-carbonblack |
| `--brand-accent` | `#009dbc` `oklch(0.64 0.118 218)` | `#00b5d8` `oklch(0.7138 0.1285 218.27)` | light: brand-cyan deepened to 3.2:1 on white; carbon text on it; dark: #00b5d8 brand-cyan |
| `--brand-accent-foreground` | `#11181c` `oklch(0.204 0.013 233.3)` | `#11181c` `oklch(0.204 0.013 233.3)` | #11181c brand-carbonblack |
| `--destructive` | `#bb061e` `oklch(0.5 0.2 25)` | `#fd8a8c` `oklch(0.76 0.14 20)` | light: AA-corrected brand-error (#ff4d4f is 3.3:1 on white); dark: brand-error lifted for text on dark tints |
| `--destructive-foreground` | `#ffffff` `oklch(1 0 0)` | `#11181c` `oklch(0.204 0.013 233.3)` | light: white; dark: #11181c brand-carbonblack |

**Feedback**

| Token | Light | Dark | Source and role |
|---|---|---|---|
| `--success` | `#007653` `oklch(0.5 0.11 165)` | `#18e0a4` `oklch(0.8047 0.1662 164.93)` | light: AA-corrected brand-pulsegreen (#18e0a4 is 1.7:1 on white); dark: #18e0a4 brand-pulsegreen |
| `--success-foreground` | `#ffffff` `oklch(1 0 0)` | `#11181c` `oklch(0.204 0.013 233.3)` | light: white; dark: #11181c brand-carbonblack |
| `--success-subtle` | `#d8fdeb` `oklch(0.962 0.045 165)` | `#103627` `oklch(0.3 0.05 165)` | light: mint tint: banners and inline feedback; dark: pulse green on graphite |
| `--warning` | `#9b540c` `oklch(0.52 0.12 58)` | `#ffb800` `oklch(0.827 0.171 80.5)` | light: AA-corrected brand-warning (#ffb800 is 1.7:1 on white); dark: #ffb800 brand-warning |
| `--warning-foreground` | `#ffffff` `oklch(1 0 0)` | `#11181c` `oklch(0.204 0.013 233.3)` | light: white; dark: #11181c brand-carbonblack |
| `--warning-subtle` | `#fff2d2` `oklch(0.965 0.045 85)` | `#402c0c` `oklch(0.31 0.055 75)` | light: amber tint; dark: amber on graphite |
| `--info` | `#0068b7` `oklch(0.51 0.15 250)` | `#3da5ff` `oklch(0.704 0.162 248.7)` | light: AA-corrected brand-signalblue; dark: #3da5ff brand-signalblue |
| `--info-foreground` | `#ffffff` `oklch(1 0 0)` | `#11181c` `oklch(0.204 0.013 233.3)` | light: white; dark: #11181c brand-carbonblack |
| `--info-subtle` | `#e4f3ff` `oklch(0.958 0.025 245)` | `#192f46` `oklch(0.3 0.05 250)` | light: signal-blue tint; dark: signal blue on graphite |
| `--destructive-subtle` | `#ffebea` `oklch(0.957 0.025 20)` | `#4c2122` `oklch(0.31 0.065 20)` | light: red tint; dark: red on graphite |

**Sidebar (app frame)**

| Token | Light | Dark | Source and role |
|---|---|---|---|
| `--sidebar` | `#f1f1f3` `oklch(0.959 0.003 286.3)` | `#0b1115` `oklch(0.175 0.012 233)` | light: #f1f1f3 brand-websitegrey: the app frame; dark: carbon, one step deeper: the app frame |
| `--sidebar-foreground` | `#1e2e3d` `oklch(0.294 0.035 247.5)` | `#f1f1f3` `oklch(0.959 0.003 286.3)` | light: #1e2e3d brand-navy; dark: #f1f1f3 brand-websitegrey |
| `--sidebar-primary` | `#11181c` `oklch(0.204 0.013 233.3)` | `#f1f1f3` `oklch(0.959 0.003 286.3)` | light: #11181c brand-carbonblack; dark: #f1f1f3 brand-websitegrey |
| `--sidebar-primary-foreground` | `#ffffff` `oklch(1 0 0)` | `#11181c` `oklch(0.204 0.013 233.3)` | light: white; dark: #11181c brand-carbonblack |
| `--sidebar-accent` | `#e2e7eb` `oklch(0.925 0.008 245)` | `#18262f` `oklch(0.26 0.025 236)` | active and hover nav item |
| `--sidebar-accent-foreground` | `#11181c` `oklch(0.204 0.013 233.3)` | `#f1f1f3` `oklch(0.959 0.003 286.3)` | light: #11181c brand-carbonblack; dark: #f1f1f3 brand-websitegrey |
| `--sidebar-border` | `#d6dbe0` `oklch(0.89 0.008 240)` | `#1d282f` `oklch(0.27 0.02 235)` | decorative |
| `--sidebar-ring` | `#0083e0` `oklch(0.6 0.17 250)` | `#3da5ff` `oklch(0.704 0.162 248.7)` | light: same as ring; dark: #3da5ff brand-signalblue |

**Charts**

| Token | Light | Dark | Source and role |
|---|---|---|---|
| `--chart-1` | `#007cd9` `oklch(0.58 0.17 250)` | `#3496ef` `oklch(0.66 0.16 250)` | signal blue |
| `--chart-2` | `#cf7b26` `oklch(0.66 0.14 60)` | `#cc7a20` `oklch(0.655 0.14 62)` | ownership amber |
| `--chart-3` | `#7a4fd9` `oklch(0.55 0.2 293)` | `#9371ee` `oklch(0.64 0.18 293)` | hyper violet |
| `--chart-4` | `#00948d` `oklch(0.6 0.105 189)` | `#1aa7a0` `oklch(0.66 0.11 189)` | operate teal |
| `--chart-5` | `#da4433` `oklch(0.6 0.19 30)` | `#e85a48` `oklch(0.65 0.18 30)` | energy coral |

**Elevation ink and scrim**

| Token | Light | Dark | Source and role |
|---|---|---|---|
| `--shadow-ink` | `0.204 0.013 233.3 / 8%` | `0 0 0 / 50%` | light: carbon at 8%; dark: black at 50%: dark relies on borders, shadows only separate overlays |
| `--shadow-ink-soft` | `0.204 0.013 233.3 / 5%` | `0 0 0 / 32%` | light: carbon at 5%; dark: black at 32% |
| `--overlay` | `0.204 0.013 233.3 / 10%` | `0 0 0 / 40%` | the scrim behind dialogs and sheets (`bg-overlay`): carbon at 10% in light, as the vendored `bg-black/10`; black at 40% in dark, where 10% does not register on carbon |

How the shadcn tokens are used here:

- `background` is the inset work surface (white / carbon). `sidebar` is the frame around it (website grey / deepest carbon). Cards sit on the work surface and are separated by a ring (`ring-1 ring-foreground/10`), not by a colour step, in light; in dark they step up to graphite.
- `muted` is the quiet fill (tab list, table header, skeletons, alternating hour bands). `secondary` is a filled neutral control (secondary button, capability badge). `accent` is the highlight of a focused menu item; it is **not** the brand accent, which is `brand-accent`.
- `border` is for decorative hairlines (card outlines, dividers, grid lines) and is exempt from contrast rules. `input` is for **control boundaries** (fields, selects, checkboxes, outline buttons, unselected chips) and is at least 3:1 against every surface a control sits on.
- `ring` is the focus colour, and the base layer makes it every element's default `outline-color`, so an outline-based focus style that names no colour (links, the skip link, `ScrollArea`) still clears 3:1. `signal` is the same hue at text strength.
- `overlay` is the scrim behind modal dialogs and sheets. Components never use `bg-black/*` or `bg-white/*`.
- Feedback colours have three roles each: `text-success` (ink on a card or the page), `bg-success text-success-foreground` (a solid fill), `bg-success-subtle text-success` (a banner, inline confirmation or table pill). Same for `warning`, `info` and `destructive`.

### 4.2 Brand extensions

| Token | Utility | Use |
|---|---|---|
| `--signal`, `--signal-foreground` | `text-signal`, `border-signal`, `bg-signal`, `text-signal-foreground` | links, the signal outline button, the 3 px active-tab and active-nav indicators, the active segment of the lane toggle, the switch "on" track |
| `--brand-accent`, `--brand-accent-foreground` | `bg-brand-accent`, `text-brand-accent-foreground` | the mobile floating Book action, the toast action. Nowhere else |
| `--destructive-foreground` | `text-destructive-foreground` | text on a solid `bg-destructive` (the "now" time label) |
| `--*-subtle` | `bg-success-subtle`, `bg-warning-subtle`, `bg-info-subtle`, `bg-destructive-subtle` | banners, conflict alerts, table pills |
| `--overlay` | `bg-overlay` | the scrim behind dialogs and sheets (17.3) |
| `--domain-*` | `.domain-tag .domain-tag-ownership` | the header tag |
| `--shadow-ink`, `--shadow-ink-soft` | consumed by `shadow-xs` to `shadow-xl` | never used directly |

### 4.3 Appointment status tokens

Each status has a **tint** (`-bg`, the block and badge fill), a **marker** (`-border`, the 3 px left bar, legend dot and badge ring) and **ink** (`-fg`, text and icon on the tint). Utilities: `bg-status-<s>-bg`, `border-status-<s>-border`, `bg-status-<s>-border` (legend dot), `text-status-<s>-fg`.

| Status (API) | Label | Hue family | Icon (lucide) | On the board |
|---|---|---|---|---|
| `Confirmed` | Confirmed | fusion purple | `CalendarCheck` | yes |
| `CheckedIn` | Checked in | sky (cyan) | `KeyRound` (keys handed over) | yes |
| `InProgress` | In progress | amber | `Wrench` | yes |
| `Completed` | Completed | settled green | `CircleCheck` | yes |
| `NoShow` | No-show | rose | `UserX` | yes |
| `Cancelled` | Cancelled | slate | `Ban` | no: cancelled appointments leave the board and the Appointments list (both read the day's schedule, which omits them); they appear in the details sheet |

| Status | Part | Light | Dark |
|---|---|---|---|
| confirmed | `-bg` | `#eaf0ff` `oklch(0.955 0.024 272)` | `#242d53` `oklch(0.31 0.07 272)` |
| confirmed | `-border` | `#5f7cff` `oklch(0.633 0.196 270.5)` | `#718fff` `oklch(0.68 0.17 270.5)` |
| confirmed | `-fg` | `#3347b2` `oklch(0.45 0.17 270)` | `#c9d6ff` `oklch(0.88 0.06 272)` |
| checked-in | `-bg` | `#e3f4fd` `oklch(0.958 0.022 230)` | `#083740` `oklch(0.31 0.05 215)` |
| checked-in | `-border` | `#14769a` `oklch(0.53 0.1 230)` | `#5bdefb` `oklch(0.84 0.12 215)` |
| checked-in | `-fg` | `#0a5470` `oklch(0.42 0.08 230)` | `#b4ecfa` `oklch(0.91 0.06 215)` |
| in-progress | `-bg` | `#fff2d6` `oklch(0.965 0.04 85)` | `#462d0b` `oklch(0.32 0.06 70)` |
| in-progress | `-border` | `#bf7b1f` `oklch(0.64 0.13 68)` | `#ffb800` `oklch(0.827 0.171 80.5)` |
| in-progress | `-fg` | `#804810` `oklch(0.46 0.1 60)` | `#ffe19f` `oklch(0.92 0.09 85)` |
| completed | `-bg` | `#e7f9e3` `oklch(0.962 0.035 140)` | `#21331d` `oklch(0.3 0.045 140)` |
| completed | `-border` | `#296f16` `oklch(0.48 0.14 140)` | `#4e943e` `oklch(0.6 0.14 140)` |
| completed | `-fg` | `#26541c` `oklch(0.4 0.1 140)` | `#bce5b3` `oklch(0.88 0.08 140)` |
| no-show | `-bg` | `#ffebed` `oklch(0.957 0.022 10)` | `#4d1f29` `oklch(0.31 0.07 8)` |
| no-show | `-border` | `#c6375c` `oklch(0.56 0.18 10)` | `#f36a8a` `oklch(0.7 0.17 8)` |
| no-show | `-fg` | `#9c1f43` `oklch(0.46 0.16 10)` | `#f9ced4` `oklch(0.89 0.05 8)` |
| cancelled | `-bg` | `#f0f2f4` `oklch(0.96 0.004 250)` | `#272c30` `oklch(0.29 0.01 245)` |
| cancelled | `-border` | `#7d8792` `oklch(0.62 0.02 250)` | `#77828c` `oklch(0.6 0.02 245)` |
| cancelled | `-fg` | `#4c5663` `oklch(0.45 0.025 255)` | `#c5cbd1` `oklch(0.84 0.01 245)` |

The five board hues were chosen together, not one by one: run through the data-viz validator (Machado 2009 colour-vision simulation, all pairs), the light set separates by ΔE 17.2 for normal vision and 9.7 under protanopia or deuteranopia; the dark set by 21.2 and 11.0 (targets: 15 and 8). That is why checked-in is a deeper sky than Keyloop's cyan in light and a lifted fusion blue in dark, and why completed is a settled green rather than Keyloop's mint. Fusion purple, amber and rose stay close to the brand.

**Deviation from Addendum B §B4, deliberate.** §B4 names Confirmed "blue" and Completed "emerald, muted". Confirmed uses Keyloop's fusion purple (`#5f7cff`, a blue-violet) instead of a generic blue, so it is a brand colour and stays apart from the signal blue that marks interaction; Completed uses a settled green (hue 140) instead of emerald, because the five hues must separate under colour-vision deficiency (the figures above). §B4's token names, its tint, marker and ink structure, and its AA rule are unchanged.

### 4.4 Contrast audit

Every pair below was computed from the `oklch()` values in `keyloop-theme.css`: OKLab to linear sRGB (CSS Color 4 matrices), per-channel clip to the sRGB gamut, then 8-bit quantisation, which is what the browser paints and what each token's `/* #hex */` comment records, so any WCAG checker reproduces a row from the hex values. Relative luminance follows WCAG 2.2. Translucent layers (Tailwind compiles `x/NN` to `color-mix(in oklab, x NN%, transparent)`) are composited over their parent in sRGB, as browsers paint them. Figures are truncated to two decimals, never rounded up past a threshold. `src/theme-tokens.test.ts` guards the status rows with the same matrices without the 8-bit step; the two methods differ by at most 0.08.

Requirements: **4.5:1** for text, **3:1** for control boundaries, focus indicators, status markers, chart marks, icons that carry meaning and large text. Every row passes in both themes, except the rows marked REPLACED: they record shipped classes, and the old default outline colour, that this theme and the section 17.3 recipes change. Decorative hairlines are listed for reference and have no minimum. A blank cell means the pair does not occur in that theme. 155 pairs, 300 evaluations. The domain tag (section 3.3) and the header band (section 12.3) are measured separately, over the interpolated gradients and over every pixel of the band images.

| Foreground | Background | Use | Light | Dark | Minimum |
|---|---|---|---:|---:|---:|
| **Core text** | | | | | |
| `foreground` | `background` | body text, titles | 13.87 | 15.89 | 4.5:1 |
| `foreground` | `card` | body text, titles | 13.87 | 14.39 | 4.5:1 |
| `foreground` | `popover` | body text, titles | 13.87 | 13.07 | 4.5:1 |
| `foreground` | `muted` | body text, titles | 12.30 | 13.35 | 4.5:1 |
| `foreground` | `secondary` | body text, titles | 12.08 | 12.30 | 4.5:1 |
| `foreground` | `accent` | body text, titles | 12.07 | 11.22 | 4.5:1 |
| `card-foreground` | `card` | card text | 13.87 | 14.39 | 4.5:1 |
| `popover-foreground` | `popover` | menus, sheets, dialogs | 13.87 | 13.07 | 4.5:1 |
| `muted-foreground` | `background` | secondary text, captions, placeholders | 5.85 | 8.41 | 4.5:1 |
| `muted-foreground` | `card` | secondary text, captions, placeholders | 5.85 | 7.61 | 4.5:1 |
| `muted-foreground` | `popover` | secondary text, captions, placeholders | 5.85 | 6.91 | 4.5:1 |
| `muted-foreground` | `muted` | secondary text, captions, placeholders | 5.19 | 7.06 | 4.5:1 |
| `muted-foreground` | `secondary` | secondary text, captions, placeholders | 5.09 | 6.51 | 4.5:1 |
| `muted-foreground` | `accent` | secondary text, captions, placeholders | 5.09 | 5.94 | 4.5:1 |
| `muted-foreground` | `sidebar` | secondary text, captions, placeholders | 5.19 | 8.91 | 4.5:1 |
| `muted-foreground` | `sidebar-accent` | secondary line in a hovered or open nav item (user row) | 4.70 | 7.26 | 4.5:1 |
| `muted-foreground` | `muted/50 on card` | table header (bg-muted/50 text-muted-foreground) | 5.51 | 7.34 | 4.5:1 |
| `secondary-foreground` | `secondary` | secondary button, capability badge, neutral pill | 12.08 | 12.30 | 4.5:1 |
| `secondary-foreground` | `secondary + 5% foreground` | secondary button hover (shipped color-mix) | 10.91 | 10.95 | 4.5:1 |
| `accent-foreground` | `accent` | highlighted menu item | 12.07 | 11.22 | 4.5:1 |
| `background` | `foreground` | tooltip (bg-foreground text-background) | 13.87 | 15.89 | 4.5:1 |
| `foreground/80 on card` | `card` | text-foreground/80 (trace id in ProblemAlert) | 7.29 | 9.66 | 4.5:1 |
| `foreground` | `signal/24 on background` | selected text (::selection, signal at 24%) | 9.68 | 10.47 | 4.5:1 |
| **Actions** | | | | | |
| `primary-foreground` | `primary` | primary button, selected slot chip, active filter pill | 17.92 | 15.89 | 4.5:1 |
| `primary-foreground` | `primary/80 on background` | primary button hover (bg-primary/80) | 9.55 | 10.46 | 4.5:1 |
| `primary-foreground/80 on primary` | `primary` | selected chip sub-line, active pill count (text-primary-foreground/80) | 11.70 | 8.87 | 4.5:1 |
| `signal` | `background` | links, signal button text | 5.73 | 6.85 | 4.5:1 |
| `signal` | `card` | links on cards | 5.73 | 6.20 | 4.5:1 |
| `signal` | `popover` | links in sheets and dialogs | 5.73 | 5.63 | 4.5:1 |
| `signal` | `muted` | links on muted panels | 5.08 | 5.75 | 4.5:1 |
| `signal` | `signal/10 on card` | signal button hover (bg-signal/10) | 4.96 | 5.28 | 4.5:1 |
| `signal-foreground` | `signal` | solid signal fill: active lane toggle segment | 5.73 | 6.85 | 4.5:1 |
| `brand-accent-foreground` | `brand-accent` | accent button: floating Book action, toast action | 5.59 | 7.34 | 4.5:1 |
| `brand-accent-foreground` | `brand-accent/90 on background` | accent button hover (bg-brand-accent/90) | 6.21 | 6.13 | 4.5:1 |
| `destructive` | `destructive/10 on popover` | destructive button in the details sheet (bg-destructive/10) | 5.53 | 5.43 | 4.5:1 |
| `destructive` | `destructive/15 on popover` | destructive button hover (bg-destructive/15) | 5.05 | 5.00 | 4.5:1 |
| `destructive-foreground` | `destructive` | solid destructive fill: 5xx pill, "now" time label | 6.65 | 7.84 | 4.5:1 |
| **Feedback** | | | | | |
| `destructive` | `card` | text-destructive on a card (alert title) | 6.65 | 7.10 | 4.5:1 |
| `destructive` | `background` | text-destructive on the page | 6.65 | 7.84 | 4.5:1 |
| `destructive` | `destructive-subtle` | banner, alert, pill: bg-destructive-subtle text-destructive | 5.80 | 5.93 | 4.5:1 |
| `foreground` | `destructive-subtle` | body text inside the destructive banner | 12.10 | 12.02 | 4.5:1 |
| `foreground/80 on destructive-subtle` | `destructive-subtle` | trace id (text-foreground/80) inside the destructive banner | 6.69 | 8.20 | 4.5:1 |
| `muted-foreground` | `destructive-subtle` | "Trace ID" label inside the destructive banner | 5.10 | 6.36 | 4.5:1 |
| `success` | `card` | text-success on a card (alert title) | 5.65 | 9.46 | 4.5:1 |
| `success` | `background` | text-success on the page | 5.65 | 10.44 | 4.5:1 |
| `success` | `success-subtle` | banner, alert, pill: bg-success-subtle text-success | 5.15 | 7.74 | 4.5:1 |
| `foreground` | `success-subtle` | body text inside the success banner | 12.66 | 11.79 | 4.5:1 |
| `foreground/80 on success-subtle` | `success-subtle` | trace id (text-foreground/80) inside the success banner | 6.91 | 8.12 | 4.5:1 |
| `muted-foreground` | `success-subtle` | "Trace ID" label inside the success banner | 5.34 | 6.23 | 4.5:1 |
| `success-foreground` | `success` | solid pill: bg-success text-success-foreground | 5.65 | 10.44 | 4.5:1 |
| `warning` | `card` | text-warning on a card (alert title) | 5.72 | 9.36 | 4.5:1 |
| `warning` | `background` | text-warning on the page | 5.72 | 10.33 | 4.5:1 |
| `warning` | `warning-subtle` | banner, alert, pill: bg-warning-subtle text-warning | 5.14 | 7.64 | 4.5:1 |
| `foreground` | `warning-subtle` | body text inside the warning banner | 12.47 | 11.75 | 4.5:1 |
| `foreground/80 on warning-subtle` | `warning-subtle` | trace id (text-foreground/80) inside the warning banner | 6.86 | 8.13 | 4.5:1 |
| `muted-foreground` | `warning-subtle` | "Trace ID" label inside the warning banner | 5.26 | 6.22 | 4.5:1 |
| `warning-foreground` | `warning` | solid pill: bg-warning text-warning-foreground | 5.72 | 10.33 | 4.5:1 |
| `info` | `card` | text-info on a card (alert title) | 5.73 | 6.20 | 4.5:1 |
| `info` | `background` | text-info on the page | 5.73 | 6.85 | 4.5:1 |
| `info` | `info-subtle` | banner, alert, pill: bg-info-subtle text-info | 5.06 | 5.22 | 4.5:1 |
| `foreground` | `info-subtle` | body text inside the info banner | 12.26 | 12.11 | 4.5:1 |
| `foreground/80 on info-subtle` | `info-subtle` | trace id (text-foreground/80) inside the info banner | 6.76 | 8.31 | 4.5:1 |
| `muted-foreground` | `info-subtle` | "Trace ID" label inside the info banner | 5.17 | 6.41 | 4.5:1 |
| `info-foreground` | `info` | solid pill: bg-info text-info-foreground | 5.73 | 6.85 | 4.5:1 |
| `destructive/90 on card` | `card` | alert description (text-destructive/90) | 5.97 | 6.01 | 4.5:1 |
| **Form fields and tabs (dark fills)** | | | | | |
| `foreground` | `input/30 on card` | typed text in a field on card (dark:bg-input/30) |  | 9.63 | 4.5:1 |
| `muted-foreground` | `input/30 on card` | placeholder in a field on card (dark:bg-input/30) |  | 5.09 | 4.5:1 |
| `foreground` | `input/30 on popover` | typed text in a field on popover (dark:bg-input/30) |  | 8.93 | 4.5:1 |
| `muted-foreground` | `input/30 on popover` | placeholder in a field on popover (dark:bg-input/30) |  | 4.73 | 4.5:1 |
| `foreground` | `input/30 on background` | typed text in a field on background (dark:bg-input/30) |  | 10.64 | 4.5:1 |
| `muted-foreground` | `input/30 on background` | placeholder in a field on background (dark:bg-input/30) |  | 5.63 | 4.5:1 |
| `foreground` | `input/50 on background` | outline button hover (dark:hover:bg-input/50) |  | 7.71 | 4.5:1 |
| `muted-foreground` | `muted` | inactive tab trigger (recipe: text-muted-foreground) | 5.19 | 7.06 | 4.5:1 |
| **Sidebar** | | | | | |
| `sidebar-foreground` | `sidebar` | nav items | 12.30 | 16.84 | 4.5:1 |
| `sidebar-accent-foreground` | `sidebar-accent` | active / hovered nav item | 14.39 | 13.71 | 4.5:1 |
| `sidebar-foreground/70 on sidebar` | `sidebar` | group labels (text-sidebar-foreground/70) | 5.03 | 8.54 | 4.5:1 |
| `sidebar-foreground/70 on sidebar-accent` | `sidebar-accent` | group label over hover | 4.78 | 7.41 | 4.5:1 |
| `sidebar-primary-foreground` | `sidebar-primary` | sidebar primary fill | 17.92 | 15.89 | 4.5:1 |
| **Appointment status** | | | | | |
| `status-confirmed-fg` | `status-confirmed-bg` | confirmed: label, service name, icon on the tint | 6.85 | 9.23 | 4.5:1 |
| `status-checked-in-fg` | `status-checked-in-bg` | checked-in: label, service name, icon on the tint | 7.40 | 10.00 | 4.5:1 |
| `status-in-progress-fg` | `status-in-progress-bg` | in-progress: label, service name, icon on the tint | 6.63 | 10.07 | 4.5:1 |
| `status-completed-fg` | `status-completed-bg` | completed: label, service name, icon on the tint | 8.05 | 9.63 | 4.5:1 |
| `status-no-show-fg` | `status-no-show-bg` | no-show: label, service name, icon on the tint | 6.82 | 9.59 | 4.5:1 |
| `status-cancelled-fg` | `status-cancelled-bg` | cancelled: label, service name, icon on the tint | 6.63 | 8.62 | 4.5:1 |
| **Brand devices** | | | | | |
| `kl-carbon-black` | `#b39cf3` | OWNERSHIP domain tag text on stop #b39cf3 | 7.65 | 7.65 | 4.5:1 |
| `kl-carbon-black` | `#cda4b2` | OWNERSHIP domain tag text on stop #cda4b2 | 8.15 | 8.15 | 4.5:1 |
| `kl-carbon-black` | `#e6ac74` | OWNERSHIP domain tag text on stop #e6ac74 | 8.97 | 8.97 | 4.5:1 |
| `card-foreground` | `card` | plate chip text (bg-card) | 13.87 | 14.39 | 4.5:1 |
| **Focus indicators (3:1)** | | | | | |
| `ring` | `background` | focus border, outline or ring (solid; also the default outline colour) | 3.94 | 6.85 | 3.0:1 |
| `ring` | `card` | focus border, outline or ring (solid; also the default outline colour) | 3.94 | 6.20 | 3.0:1 |
| `ring` | `popover` | focus border, outline or ring (solid; also the default outline colour) | 3.94 | 5.63 | 3.0:1 |
| `ring` | `muted` | focus border, outline or ring (solid; also the default outline colour) | 3.49 | 5.75 | 3.0:1 |
| `ring` | `secondary` | focus border, outline or ring (solid; also the default outline colour) | 3.43 | 5.30 | 3.0:1 |
| `ring` | `accent` | focus border, outline or ring (solid; also the default outline colour) | 3.43 | 4.83 | 3.0:1 |
| `ring` | `sidebar` | focus border, outline or ring (solid; also the default outline colour) | 3.49 | 7.26 | 3.0:1 |
| `ring` | `sidebar-accent` | focus border, outline or ring (solid; also the default outline colour) | 3.16 | 5.91 | 3.0:1 |
| **Boundaries and markers (3:1)** | | | | | |
| `input` | `background` | field, select, checkbox, chip and outline-button boundary | 3.63 | 4.49 | 3.0:1 |
| `input` | `card` | field, select, checkbox, chip and outline-button boundary | 3.63 | 4.07 | 3.0:1 |
| `input` | `popover` | field, select, checkbox, chip and outline-button boundary | 3.63 | 3.69 | 3.0:1 |
| `input` | `muted` | field, select, checkbox, chip and outline-button boundary | 3.21 | 3.77 | 3.0:1 |
| `input` | `secondary` | field, select, checkbox, chip and outline-button boundary | 3.16 | 3.47 | 3.0:1 |
| `input` | `accent` | field, select, checkbox, chip and outline-button boundary | 3.15 | 3.17 | 3.0:1 |
| `input` | `sidebar` | field, select, checkbox, chip and outline-button boundary | 3.21 | 4.76 | 3.0:1 |
| `input` | `status-confirmed-bg` | plate chip outline on the confirmed tint | 3.18 | 3.34 | 3.0:1 |
| `input` | `status-checked-in-bg` | plate chip outline on the checked-in tint | 3.22 | 3.22 | 3.0:1 |
| `input` | `status-in-progress-bg` | plate chip outline on the in-progress tint | 3.27 | 3.20 | 3.0:1 |
| `input` | `status-completed-bg` | plate chip outline on the completed tint | 3.29 | 3.38 | 3.0:1 |
| `input` | `status-no-show-bg` | plate chip outline on the no-show tint | 3.17 | 3.41 | 3.0:1 |
| `input` | `status-cancelled-bg` | plate chip outline on the cancelled tint | 3.23 | 3.53 | 3.0:1 |
| `signal` | `background` | signal button border, 3 px tab and nav indicator | 5.73 | 6.85 | 3.0:1 |
| `signal` | `popover` | today ring in the calendar popover (ring-signal) | 5.73 | 5.63 | 3.0:1 |
| `brand-accent` | `background` | floating Book action edge | 3.20 | 7.34 | 3.0:1 |
| `primary` | `background` | selected chip / primary fill edge | 17.92 | 15.89 | 3.0:1 |
| `destructive` | `card` | "now" line on the timeline; invalid field border on a card | 6.65 | 7.10 | 3.0:1 |
| `destructive` | `muted/40 on card` | "now" line across an hour band (bg-muted/40) | 6.32 | 6.85 | 3.0:1 |
| `destructive` | `popover` | invalid field border in a dialog or sheet (aria-invalid:border-destructive) | 6.65 | 6.45 | 3.0:1 |
| `status-confirmed-border` | `card` | confirmed: 3 px left bar, legend dot, card edge | 3.61 | 5.46 | 3.0:1 |
| `status-checked-in-border` | `card` | checked-in: 3 px left bar, legend dot, card edge | 5.13 | 10.27 | 3.0:1 |
| `status-in-progress-border` | `card` | in-progress: 3 px left bar, legend dot, card edge | 3.46 | 9.36 | 3.0:1 |
| `status-completed-border` | `card` | completed: 3 px left bar, legend dot, card edge | 6.21 | 4.35 | 3.0:1 |
| `status-no-show-border` | `card` | no-show: 3 px left bar, legend dot, card edge | 5.11 | 5.59 | 3.0:1 |
| `status-cancelled-border` | `card` | cancelled: 3 px left bar, legend dot, card edge | 3.65 | 4.14 | 3.0:1 |
| `status-confirmed-border` | `muted/40 on card` | confirmed: left bar on an hour band (bg-muted/40) | 3.43 | 5.28 | 3.0:1 |
| `status-checked-in-border` | `muted/40 on card` | checked-in: left bar on an hour band (bg-muted/40) | 4.88 | 9.91 | 3.0:1 |
| `status-in-progress-border` | `muted/40 on card` | in-progress: left bar on an hour band (bg-muted/40) | 3.28 | 9.03 | 3.0:1 |
| `status-completed-border` | `muted/40 on card` | completed: left bar on an hour band (bg-muted/40) | 5.90 | 4.20 | 3.0:1 |
| `status-no-show-border` | `muted/40 on card` | no-show: left bar on an hour band (bg-muted/40) | 4.86 | 5.40 | 3.0:1 |
| `status-cancelled-border` | `muted/40 on card` | cancelled: left bar on an hour band (bg-muted/40) | 3.46 | 3.99 | 3.0:1 |
| `chart-1` | `card` | chart series 1 | 4.29 | 5.22 | 3.0:1 |
| `chart-2` | `card` | chart series 2 | 3.22 | 4.92 | 3.0:1 |
| `chart-3` | `card` | chart series 3 | 5.31 | 4.51 | 3.0:1 |
| `chart-4` | `card` | chart series 4 | 3.73 | 5.47 | 3.0:1 |
| `chart-5` | `card` | chart series 5 | 4.32 | 4.62 | 3.0:1 |
| `chart-1` | `muted` | utilisation meter fill on its bg-muted track | 3.81 | 4.84 | 3.0:1 |
| `success` | `card` | status icon on a card (success) | 5.65 | 9.46 | 3.0:1 |
| `warning` | `card` | status icon on a card (warning) | 5.72 | 9.36 | 3.0:1 |
| `destructive` | `card` | status icon on a card (destructive) | 6.65 | 7.10 | 3.0:1 |
| `success` | `success-subtle` | outcome icon on its tile (bg-success-subtle) | 5.15 | 7.74 | 3.0:1 |
| `warning` | `warning-subtle` | outcome icon on its tile (bg-warning-subtle) | 5.14 | 7.64 | 3.0:1 |
| `info` | `info-subtle` | outcome icon on its tile (bg-info-subtle) | 5.06 | 5.22 | 3.0:1 |
| `destructive` | `destructive-subtle` | outcome icon on its tile (bg-destructive-subtle) | 5.80 | 5.93 | 3.0:1 |
| `input` | `background` | switch: unchecked track edge (bg-input) | 3.63 | 4.49 | 3.0:1 |
| `background` | `input` | switch: thumb on the unchecked track | 3.63 | 4.49 | 3.0:1 |
| `background` | `signal` | switch: thumb on the checked track (bg-signal) | 5.73 | 6.85 | 3.0:1 |
| **REPLACED: shipped classes that this theme or the recipes change** | | | | | |
| `ring/50 on background` | `background` | old default outline colour (outline-ring/50) on background: BLOCK 4 now uses outline-ring | 1.94 | 2.62 | 3.0:1 |
| `ring/50 on card` | `card` | old default outline colour (outline-ring/50) on card: BLOCK 4 now uses outline-ring | 1.94 | 2.55 | 3.0:1 |
| `ring/50 on popover` | `popover` | old default outline colour (outline-ring/50) on popover: BLOCK 4 now uses outline-ring | 1.94 | 2.45 | 3.0:1 |
| `destructive/40 on popover` | `popover` | shipped destructive-button focus border (focus-visible:border-destructive/40) | 2.18 | 2.14 | 3.0:1 |
| `destructive/50 on popover` | `popover` | shipped invalid field border in dark (dark:aria-invalid:border-destructive/50) |  | 2.62 | 3.0:1 |
| `foreground/60 on muted` | `muted` | inactive tab trigger (text-foreground/60), light | 3.76 |  | 4.5:1 |
| `destructive` | `destructive/30 on popover` | destructive button hover (dark:hover:bg-destructive/30) |  | 3.68 | 4.5:1 |
| `muted-foreground` | `primary` | muted sub-line left on a selected chip (11.6 overrides it) | 3.06 | 1.88 | 4.5:1 |
| **Decorative (exempt, reported)** | | | | | |
| `border` | `background` | card outlines, dividers, grid hour lines | 1.33 | 1.48 | none |
| `border` | `card` | hairlines inside cards | 1.33 | 1.34 | none |
| `sidebar-border` | `sidebar` | sidebar separators | 1.23 | 1.26 | none |

The REPLACED rows, and what replaces them:

- **Default outline colour** `outline-ring/50`: 1.94:1 on white, 2.45:1 to 2.62:1 in dark. BLOCK 4 now sets the solid `outline-ring` (3.94:1 light, 5.63:1 or more dark).
- **Destructive button focus** `focus-visible:border-destructive/40`: 2.18:1 light, 2.14:1 dark on the details sheet. The recipe removes the override, so the base `focus-visible:border-ring` applies (3.94:1 light, 5.63:1 dark).
- **Invalid field border in dark** `dark:aria-invalid:border-destructive/50`: 2.62:1. The recipe keeps the solid `aria-invalid:border-destructive` in both themes (6.65:1 light, 6.45:1 dark on popover).
- **Inactive tab** `text-foreground/60`: 3.76:1. The recipe uses `text-muted-foreground` (5.19:1).
- **Dark destructive hover** `bg-destructive/30`: 3.68:1. The recipe uses `hover:bg-destructive/15` in both themes (5.00:1 or more).
- **Muted sub-line on a selected chip or active pill**: `text-muted-foreground` on `bg-primary` is 3.06:1 light and 1.88:1 dark. Section 11.6 switches it to `text-primary-foreground/80` when selected (11.70:1 light, 8.87:1 dark).

## 5. Typography

### 5.1 Families and packages

| Role | Family | npm package | Import (in `src/main.tsx`) | Weights | CSS variable / utility |
|---|---|---|---|---|---|
| Headings, page titles, KPI figures, wordmark | Plus Jakarta Sans (variable) | `@fontsource-variable/plus-jakarta-sans@^5.3.0` | `import "@fontsource-variable/plus-jakarta-sans/wght.css"` | 200–800 axis; we use 600, 700, 800 | `--font-display`, `font-heading` (and every `h1`–`h4`) |
| UI and body | IBM Plex Sans (variable) | `@fontsource-variable/ibm-plex-sans@^5.3.0` | `import "@fontsource-variable/ibm-plex-sans/wght.css"` | 100–700 axis; we use 400, 500, 600 | `--font-ui`, `font-sans` (the default) |
| VINs, registrations, trace ids, problem slugs | IBM Plex Mono | `@fontsource/ibm-plex-mono@^5.3.0` | `import "@fontsource/ibm-plex-mono/400.css"` and `import "@fontsource/ibm-plex-mono/500.css"` | 400, 500 | `--font-code`, `font-mono` |

These replace `@fontsource-variable/inter` (remove the package and its import). 5.3.0 is the current version of all three (checked with `pnpm view <package> version` on 2026-10-12). The packages ship `woff2` files split by `unicode-range`, so a browser downloads only the Latin files for English UI: about 45 KB (Plex Sans), 27 KB (Jakarta) and 2 × 15 KB (Plex Mono). Faces use `font-display: swap`; the fallback is the system UI stack. Font files must never be inlined into the CSS (section 17.1, step 4).

### 5.2 Type scale (app UI)

| Role | Family | Size / line height | Weight | Tracking | Utilities |
|---|---|---|---|---|---|
| Page title (`h1`) | Jakarta | 24/32 (mobile 20/28) | 700 | -0.025 em | `text-xl md:text-2xl font-bold tracking-tight` |
| Section or card title (`h2`, `CardTitle`) | Jakarta | 18/28 | 600 | normal | `font-heading text-lg font-semibold` |
| Subsection, dialog step title (`h3`) | Jakarta | 16/24 | 600 | normal | `font-heading text-base font-semibold` |
| Product title in the header | Jakarta | 16/24 | 700 | -0.025 em | `font-heading text-base font-bold tracking-tight` |
| Wordmark "Keyloop" | Jakarta | 17/24 | 800 | -0.025 em | `font-heading text-wordmark font-extrabold tracking-tight` |
| KPI figure | Jakarta | 30/36 (mobile 24/32) | 700 | -0.025 em | `font-heading text-2xl md:text-3xl font-bold tracking-tight tabular-nums` |
| Body, table text, form text | Plex Sans | 14/20 | 400 | normal | `text-sm` |
| Inputs on touch, long-form text | Plex Sans | 16/24 | 400 | normal | `text-base md:text-sm` (16 px stops iOS zooming into fields) |
| Buttons | Plex Sans | 14/20 | 600 | normal | `text-sm font-semibold` |
| Field labels, tab labels | Plex Sans | 14/20 | 500 | normal | `text-sm font-medium` |
| Dense: timeline blocks, agenda meta | Plex Sans | 13/18 | 400; 600 for service names | normal | `text-dense`, `text-dense font-semibold` |
| Caption, meta, chip sub-line | Plex Sans | 12/16 | 400 or 500 | normal | `text-xs` |
| Small print: the "now" time pill, avatar initials in timeline blocks | Plex Sans | 11/16 | 600 | normal | `text-2xs` |
| Domain tag | Plex Sans | 11 | 600, uppercase | 0.2 em | `.domain-tag` |
| VIN, trace id | Plex Mono | 12/16 | 400 | 0.025 em | `font-mono text-xs tracking-wide` |
| Registration plate | Plex Mono | 12 | 500, uppercase | 0.04 em | `.plate-chip` |

Rules:

- Times, durations, counts and money use `tabular-nums` so columns and ticking values do not jitter.
- Headings use sentence case and no closing full stop. Keyloop's full-stop headline ("Fusion. The Automotive Retail Platform.") is a marketing device; the one place it fits in this app is the short headline of an illustrated state ("Booked."), and even there it is optional.
- Capitals appear only where the real world uses them: the domain tag, registration plates, VINs.
- Body copy in sheets and dialogs stays under about 70 characters a line (`max-w-prose`).

Where this scale departs from keyloop.com, on purpose:

- **Body 14/20 instead of 16/24**: a dispatch board is dense working UI (Addendum B §B4); 16 px stays for inputs on touch, where it stops iOS zooming into fields.
- **Card titles weight 600 instead of 700**: they sit next to 700-weight KPI figures, which carry the emphasis.
- **Buttons 40 px instead of 46 px** (section 11.2): 46 px is a marketing CTA height; touch layouts still get 44 px.
- **No circle-arrow "Learn more" icon**: the app has no "learn more" links. Navigational links use a trailing `ChevronRight`, external links `ArrowUpRight` (section 11.3).

## 6. Spacing and layout grid

- **Base unit 4 px** (Tailwind's `--spacing: 0.25rem`). Inside components use 4, 8 and 12 px (`gap-1`, `gap-2`, `gap-3`); between components and sections use the **8 px rhythm**: 16, 24, 32 (`gap-4`, `gap-6`, `gap-8`).
- **Page gutters**: 16 px on phones, 24 px from `md`, 32 px from `xl` (`px-4 md:px-6 xl:px-8`). Vertical page padding `py-4 md:py-6`.
- **Header** 56 px (`--header-height`, `h-14`). **Sidebar** 16 rem (256 px) when expanded.
- **Content width**: the dispatch board and tables are fluid (the timeline uses every pixel). Forms, dialogs and the booking flow cap at `max-w-2xl` (672 px); side sheets at `sm:max-w-md` (448 px); reading text at `max-w-prose`.
- **Card padding** 16 px (`Card`), 12 px for compact cards (`size="sm"`, KPI tiles, job cards).
- **Grids**: KPI strip `grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4`; empty-state and form layouts are single column below `md`.

## 7. Shape: radius

The control radius is the base: `--radius: 0.375rem` (6 px). The Tailwind radius scale is derived from it in `@theme inline`:

| Utility | Value | Use |
|---|---|---|
| `rounded-sm` | 3 px | checkbox, `kbd` |
| `rounded-md` | 4 px | menu items, tab triggers, tooltips, timeline appointment blocks, the plate chip |
| `rounded-lg` | **6 px** | **controls**: buttons, inputs, selects, popovers, dropdowns, alerts |
| `rounded-chip` | **8 px** | **chips**: availability slot chips, status icon tiles, agenda job cards, the domain tag |
| `rounded-xl` | **12 px** | **cards**: cards, dialogs, the inset work surface, the timeline container |
| `rounded-2xl` | 16 px | toasts, the top corners of a bottom sheet (Keyloop's popovers and toasts use about 16 px) |
| `rounded-full` | pill | badges, status badges, avatars, the floating Book action, filter pills, the "now" time label |

Nested corners stay concentric: an element inset by `p` inside a radius `r` gets `r − p` (tab triggers inside the 3 px-padded tab list use `rounded-md`).

## 8. Elevation

Geometry lives in `@theme inline`; the shadow colour is a per-theme token (`--shadow-ink` 8 % carbon in light, 50 % black in dark; `--shadow-ink-soft` 5 % / 32 %).

| Utility | Geometry | Use |
|---|---|---|
| `shadow-xs` | `0 1px 2px` | agenda job cards, KPI tiles, chips at rest |
| `shadow-sm` | `0 1px 3px, 0 1px 2px -1px` | the inset work surface (already set by the sidebar), selected segmented tab |
| `shadow-md` | `0 4px 8px -2px, 0 2px 4px -2px` | a hovered appointment block, popovers, select and dropdown menus |
| `shadow-lg` | `0 12px 16px -4px, 0 4px 6px -2px` | sheets, toasts, the floating Book action |
| `shadow-xl` | `0 20px 25px -5px, 0 8px 10px -6px` | dialogs (Keyloop's card shadow, the strongest we use) |

Light is soft: shadows only hint at lift, and cards also carry `ring-1 ring-foreground/10`. **Dark is border-led**: a shadow on carbon is barely visible, so separation comes from the surface steps (frame `#0b1115` → page `#11181c` → card `#162228` → popover `#1b2a32`) and the same `ring-1 ring-foreground/10`. Do not add coloured glows.

## 9. Iconography

- **Library**: `lucide-react` (already the shadcn icon library). No other icon set, no emoji.
- **Sizes**: 16 px (`size-4`) in buttons, inputs, menus and inline text; 14 px (`size-3.5`) in badges, status badges and timeline blocks; 20 px (`size-5`) in status icon tiles and alert headers on mobile; 24 px (`size-6`) in the floating Book action.
- **Stroke**: lucide's default 2 px. Do not mix stroke widths in one view.
- **Colour**: icons inherit `currentColor`. A status icon uses the status ink (`text-status-<s>-fg`), a feedback icon the feedback ink (`text-warning`).
- **Accessibility**: decorative icons next to a text label get `aria-hidden="true"`. An icon-only button needs `aria-label` and a `Tooltip` with the same words.
- **Outcome icons (Service Hub's traffic light)**: `CircleCheck` in `text-success` (done: 201, booked, copied), `TriangleAlert` in `text-warning` (needs attention: a 409 conflict, a 422 rule, a 404 that a reload fixes), `CircleX` in `text-destructive` (failed: 5xx, network, a failed toast). Always with words; never swap them between meanings.
- **Vocabulary**: `Plus` (book), `CalendarDays` (date), `ChevronLeft`/`ChevronRight` (previous/next day, and the trailing chevron on navigational links), `RotateCw` (retry, auto-refresh), `Copy`/`Check` (copy trace id), `CircleAlert` (a field error, 400), `Clock` (rate limited, 429), `Zap` (EV bay capability), `Ruler` (alignment), `Wrench` (in progress), plus the outcome icons above and the status icons in section 4.3.

## 10. Motion

| Token | Value | Use |
|---|---|---|
| `duration-100` | 100 ms | colour and background changes on hover and press |
| `duration-150` | 150 ms | tooltip and popover fade, block shadow on hover, chevron nudge |
| `duration-200` | 200 ms | dialog and side sheet enter and leave (the shadcn default), tab indicator slide |
| `duration-300` | 300 ms | bottom sheet and full-screen booking sheet slide |
| `ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | everything that enters or moves |
| `ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | everything that leaves |
| `animate-booked` | three 1 s outline halos in `--ring` | the block of a booking that was just made (Addendum B §B4's "pulses for 3 s"), when the user follows **View on board** |

Rules:

- Motion answers an action (open, close, confirm, follow a link to the board). There is no ambient or entrance animation on page load besides the existing route progress bar.
- `prefers-reduced-motion: reduce` already zeroes animation and transition durations globally in `index.css`. Every animated state must also have a **static** equivalent: the just-booked block also gets `ring-2 ring-ring` for 3 s; the skeleton shows as a still `bg-muted` shape.
- Never animate layout properties in the timeline (positions are data); animate opacity, transform, shadow and outline only.

## 11. Components

The shadcn components in `src/components/ui` keep their APIs. Section 17.3 lists the class changes this theme expects in them. Everything below names the semantic utilities to use.

### 11.1 App shell

```
┌ frame: bg-sidebar ──────────────────────────────────────────────────────────────────┐
│ ┌ sidebar ──────────┐ ┌ work surface: bg-background ──────────────────────────────┐ │
│ │ Workshop          │ │ [≡] [OWNERSHIP] Service Scheduler    Keyloop [◐]          │ │
│ │ ▌▣ Dispatch board │ │ ──────────────────────────────────────────────────────────│ │
│ │  ☰ Appointments   │ │ Dispatch board            [toolbar …] [+ Book]            │ │
│ │                   │ │ Reading · Tuesday 13 October                              │ │
│ │ API reference     │ │ KPI     KPI     KPI     KPI                               │ │
│ │ (user)            │ │ timeline card (scrolls inside)                            │ │
│ │ Take-home demo …  │ │                                                           │ │
│ └───────────────────┘ └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

- **Frame**: `SidebarProvider` with the `inset` sidebar variant (as built). The wrapper is `bg-sidebar`; `SidebarInset` is `bg-background md:rounded-xl md:shadow-sm`.
- **Header** (`SiteHeader`, 56 px, `border-b border-border`), left to right: `SidebarTrigger`; the domain tag `<span className="domain-tag domain-tag-ownership">Ownership</span>` (write the word in sentence case; CSS uppercases it, so screen readers say "Ownership", not letters); the product title "Service Scheduler" (`font-heading text-base font-bold tracking-tight`, a `span`, not a heading: the page title is the `h1`); then, pushed right, the wordmark "Keyloop" (`font-heading text-wordmark font-extrabold tracking-tight text-foreground`, a plain `span`: never a link to keyloop.com, never an image) and the theme toggle.
  - Below `sm` (640 px) the header holds only the trigger, the tag and the title (the title truncates); the wordmark moves into the mobile sidebar sheet's header and the theme toggle into its footer.
- **Sidebar**: no brand block on desktop (the header carries the brand). Inside the mobile sheet, `SidebarHeader` shows the glyph tile and the wordmark (`md:hidden`). Nav items are 40 px tall (44 px on touch). The **active item** is `bg-sidebar-accent font-semibold` plus a 3 px signal bar on its inline start (`data-active:shadow-[inset_3px_0_0_var(--signal)]`), so the state is not carried by a pale fill alone. Group labels ("Workshop", "Resources", "Settings", in that order) are `text-xs font-medium text-sidebar-foreground/70` (5.0:1).
- **User row**: the template's nav-user in `SidebarFooter`, above the provenance line: who is signed in and their role, with the account menu (11.20). On a phone it is in the sidebar sheet's footer, one tap from the header's trigger.
- **Provenance line**: the last item in `SidebarFooter`, below the user row, on desktop and in the mobile sidebar sheet: `<p className="px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">Take-home demo · inspired by Keyloop's public design language · not an official Keyloop product</p>` (5.19:1 on the sidebar). It is not dismissible. Screenshots and videos for the README show it.
- **Option considered: Service Hub's carbon app bar.** Not used. The light header stays part of the work surface so the OWNERSHIP tag and the header band read; in dark mode the header is already carbon, which is the app bar.
- **Page header** (`BaseLayout` title row): `h1` page title, a one-line description in `text-muted-foreground`, actions on the right; actions wrap below the title under `md`.
- **Header band**: on the dispatch board only, a decorative image behind the header (section 12.3).

### 11.2 Buttons

Height: **40 px** default; compact 36 px (`sm`, `icon-sm`) for dense desktop toolbars and table rows; 24 px (`xs`, `icon-xs`) only for the copy button beside a trace id. **Every size grows to 44 px on touch** (`pointer-coarse:h-11`, `pointer-coarse:size-11`, section 17.3), so no size is exempt from the touch-target rule. Padding 16 px (`px-4`), radius `rounded-lg` (6 px), `text-sm font-semibold`. Icon-only buttons are square at the same heights. Keyloop's 46 px marketing CTA height is not used in the app.

| Variant | Classes | Use |
|---|---|---|
| `default` (primary) | `bg-primary text-primary-foreground hover:bg-primary/80` | the one primary action: **Book appointment**, **Book** (dialog submit), **Try again** on a full-page error |
| `accent` (new) | `bg-brand-accent text-brand-accent-foreground hover:bg-brand-accent/90` | the mobile floating Book action; the toast's **View on board**. Nowhere else |
| `signal` (new: Keyloop's outline button) | `border border-signal bg-transparent text-signal hover:bg-signal/10` | secondary calls to action that move the user on: **Go to next open day**, **Try Wednesday 14 October**, **Book another** |
| `outline` (neutral) | `border border-input bg-background hover:bg-muted dark:bg-input/30 dark:hover:bg-input/50` | field-like triggers (date, dealership), **Cancel** in dialogs, toolbar buttons |
| `secondary` | `bg-secondary text-secondary-foreground` | low-emphasis filled actions (**Back** in the booking stepper) |
| `ghost` | `hover:bg-muted hover:text-foreground` | icon buttons in headers and toolbars, copy buttons |
| `destructive` | `bg-destructive/10 text-destructive hover:bg-destructive/15` (both themes) | **Cancel appointment** in the details sheet |
| `link` | `text-signal font-semibold underline-offset-4 hover:underline` | inline navigation |

- A trailing `ChevronRight` (size 4, `transition-transform duration-150 group-hover/button:translate-x-0.5`) marks actions that **navigate** (View on board, Go to next open day). Do not add chevrons to actions that act in place (Book, Cancel, Copy).
- Focus: shadcn's `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50` on **every** variant. The 1 px `border-ring` is the WCAG part (3.9:1 light, 5.6:1 or more dark); the 3 px translucent halo is Keyloop's signal-blue halo. No variant recolours its focus: the shipped `destructive` variant's `focus-visible:border-destructive/40 focus-visible:ring-destructive/20` (2.1:1) is removed by the recipe, so **Cancel appointment** shows the same signal focus as every other control. One focus colour app-wide is easier to find than a per-variant one.
- Disabled: `disabled:opacity-50 disabled:pointer-events-none` (inactive controls are exempt from contrast rules, but explain why something is disabled nearby, e.g. "Pick a start time").
- Loading: keep the label, add a leading `Loader2` with `animate-spin`, set `aria-busy`, and disable the button.

### 11.3 Links

- Running-text links: `text-signal underline underline-offset-4` (underlined at rest: colour is not the only cue, WCAG 1.4.1).
- Standalone navigational links: `text-signal font-semibold` with a trailing `ChevronRight`, underline on hover.
- External links (API reference): trailing `ArrowUpRight` and `<span className="sr-only">(opens in a new tab)</span>`.
- Focus, every link: `rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring` (3.9:1 light, 5.6:1 or more dark). Links styled as buttons (`buttonVariants`) use the button focus instead.

### 11.4 Inputs, selects and the date control

- Height 40 px (44 px on touch), `rounded-lg border border-input bg-transparent dark:bg-input/30`, text `text-base md:text-sm`, placeholder `text-muted-foreground` (4.7:1 or more on every field fill).
- Labels above the field (`text-sm font-medium`), help text below (`text-xs text-muted-foreground`), error below (`text-sm text-destructive`, with `CircleAlert`), and `aria-invalid` on the field (shadcn turns the border `border-destructive`, 6.4:1 or more in both themes once the 17.3 recipe removes the dark `/50`). Errors from a 400 problem are mapped to their fields.
- Right `inputMode` and `autoComplete`: `email`, `tel`, `name`; the VIN field uses `autoCapitalize="characters"`, `spellCheck={false}`, `font-mono tracking-wide`.
- **Date control** (toolbar): `[‹] [CalendarDays Tue 13 Oct] [›]`, an outline button group; the middle opens a `Popover` with the `Calendar`. Selected day `bg-primary text-primary-foreground`, today `ring-1 ring-signal`, closed days `text-muted-foreground line-through` and disabled. The label uses the dealership's time zone.
- **Select** (dealership, service): trigger as a field; menu `rounded-lg bg-popover shadow-md`, focused item `bg-accent text-accent-foreground`. Service options show duration and requirement badges on a second line; unbookable services are disabled with the reason.

### 11.5 Tabs

- **Segmented** (the board's **Bays | Technicians** lane toggle): shadcn `TabsList` default variant, `h-10`, `bg-muted p-[3px] rounded-lg`; active trigger `bg-signal text-signal-foreground shadow-xs` in both themes (5.7:1 light, 6.8:1 dark), Service Hub's signal-blue "My repair orders / All repair orders" toggle; inactive `text-muted-foreground hover:not-data-active:text-foreground` (the hover must never reach the active segment: `text-foreground` on the signal fill is 2.4:1 light and 2.3:1 dark). It shows a selection, not an action, so it does not compete with the one primary button.
- **Line** (page-level sections): `TabsList variant="line"`; triggers `text-sm font-medium`, inactive `text-muted-foreground`, active `text-foreground` with a **3 px signal indicator** under it (Keyloop Trust Center style): `after:h-[3px] after:bg-signal after:rounded-full`.

### 11.6 Badges, chips and pills

- **Badge** (`h-6 px-2 rounded-full text-xs font-medium`, icons `size-3.5`):
  - capability (EV, Alignment, Diagnostics): `variant="secondary"`, with an icon where one exists (`Zap` for EV);
  - certification or missing requirement (422 `no-qualified-resources`): `variant="outline"` with `border-input`.
- **Status badge**: `bg-status-<s>-bg text-status-<s>-fg ring-1 ring-inset ring-status-<s>-border/40`, status icon then label ("Checked in"). Always icon **and** label.
- **Availability slot chips** (booking step 1): a Base UI `RadioGroup` whose `Radio.Root` items are the chips, so arrow keys move between chips, Space selects and Tab enters and leaves the group. Chip: `group/slot rounded-chip h-10 pointer-coarse:h-11 min-w-20 px-3 border border-input bg-card text-sm font-medium tabular-nums hover:not-data-checked:bg-accent`; second line `text-xs text-muted-foreground` with capacity ("3 bays · 2 techs"). Selected (`data-checked`): `data-checked:bg-primary data-checked:text-primary-foreground data-checked:border-primary`, and the second line switches to `group-data-checked/slot:text-primary-foreground/80` (11.70:1 light, 8.87:1 dark; left muted it would be 3.06:1 and 1.88:1). The hover must be `hover:not-data-checked:bg-accent`, not `hover:bg-accent`: shadcn's `data-checked` variant compiles to a zero-specificity `:where()`, so a plain `hover:` class outranks it and a hovered selected chip would turn pale with white text (about 1.1:1). Grouped under **Morning** / **Afternoon** headings (`text-xs font-medium text-muted-foreground`). Only available slots render. Conflict suggestions (11.16) use the same chip as a plain button: one click re-submits.
- **Suggested-service cards** (booking intake triage, step 1 of the booking dialog): a Base UI `RadioGroup` of cards, like the slot chips (arrow keys move and choose, Tab enters and leaves). Card: `group/candidate rounded-chip border border-input bg-card p-3 min-h-14 hover:not-data-checked:bg-accent`, a grid of the radio mark, the service (name `text-sm font-semibold`, duration `text-xs text-muted-foreground tabular-nums`, its capability badges wrapping below) and the likelihood: the word (*Likely* `text-xs font-semibold text-foreground` for the one confident suggestion, *Possible* `text-xs text-muted-foreground` for the rest), the percentage `font-heading text-sm font-bold tabular-nums`, and the thin meter of section 13 under it. Selected (`data-checked`): `border-primary ring-1 ring-primary` and a filled radio mark (`bg-primary` with a `bg-primary-foreground` dot), so the choice never rests on the border alone; focus is the control focus of 11.2. A service the dealership cannot book: `data-disabled:border-dashed` with the reason as its description. The section around them is a hairline frame (`rounded-xl border border-border p-3 sm:p-4`); its actions are *Suggest a service* (`outline`, `ScanSearch`) and *Use this* (`signal`), so the step keeps one primary action (*Next*). The day asked for is a chip like the date control (`rounded-chip border border-input`, `CalendarDays`; a closed day or one that has passed `CalendarX2`, `text-muted-foreground line-through` and a sentence saying which it is and that it is not applied).
- **Filter pills with counts** (agenda lane picker, quick views): a Base UI `ToggleGroup` of `Toggle`s. Pill: `group/pill rounded-full h-9 pointer-coarse:h-11 px-3 border border-input text-sm hover:not-data-pressed:bg-muted`, the count `tabular-nums text-muted-foreground`; active (`data-pressed`): `data-pressed:bg-primary data-pressed:text-primary-foreground data-pressed:border-primary`, the count `group-data-pressed/pill:text-primary-foreground/80`.

### 11.7 Domain tag

`<span className="domain-tag domain-tag-ownership">Ownership</span>`: 24 px tall, 11 px Plex Sans 600 uppercase with 0.2 em tracking, carbon text on the OWNERSHIP gradient, 8 px radius. One per screen, in the header. Never used as a status, a filter, a button or a section label.

### 11.8 Registration plate, VIN, trace id

- **Plate chip**: `<span className="plate-chip"><span className="sr-only">Registration </span>RE21 KLP</span>`. Outlined (`border-input`), mono 12 px, uppercase, `bg-card` so it reads as a plate even on a status tint. Keep the space the DVLA format uses ("RE21 KLP").
- **VIN**: `font-mono text-xs tracking-wide`, uppercase, 17 characters. In sheets and cards show it whole (`break-all`); in timeline blocks show it only when the block is at least 160 px wide, otherwise rely on the plate chip and keep the full VIN in the tooltip and `aria-label` ("VIN WVWZZZ1KZ6W123456").
- **Trace id** (problem details): label "Trace ID" in `text-xs text-muted-foreground`, value `font-mono text-xs text-foreground/80 truncate` with `title`, then a ghost icon button **Copy trace ID** (`Copy` → `Check` for 2 s, announced "Trace ID copied").

### 11.9 Initials avatar

`rounded-full bg-secondary text-secondary-foreground font-semibold`, `size-6 text-2xs` in timeline blocks, `size-8 text-xs` in cards and sheets; `ring-2 ring-card` when it overlaps a tint. Initials come from the technician's name (first + last). The avatar is `aria-hidden`; the name is always written next to it or in the element's `aria-label`. On an agenda card (11.13) the written name is the other resource: the technician in bay mode, the bay in technician mode.

### 11.10 Status icon tiles

Service Hub's row of tinted squares: `inline-flex size-9 items-center justify-center rounded-chip bg-status-<s>-bg text-status-<s>-fg`, icon `size-5`. Used in the details sheet header and the KPI cards (e.g. a `KeyRound` tile on "6 checked in"). Each tile has a text label next to it, or the tile is a `span` with `role="img"` and an `aria-label`. The same tile in the feedback colours (`bg-success-subtle text-success`, and so on) is the outcome tile of section 11.17.

### 11.11 KPI cards

`Card size="sm"` with `shadow-xs`: label `text-sm text-muted-foreground` (top), figure `font-heading text-2xl md:text-3xl font-bold tracking-tight tabular-nums`, context line `text-xs text-muted-foreground` ("of the opening window", "Interim Service"), optional status icon tile on the right. Four cards: *Appointments today*, *Bay utilisation*, *Technicians busy now*, *Next free slot* (Addendum B §B4). No trend badges or arrows: the API has no history to compare with (section 11.19). Loading: a skeleton of the same shape. Grid `grid-cols-2 lg:grid-cols-4`.

### 11.12 Timeline grid and appointment blocks

Container: `rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden`; horizontal scrolling happens inside it only.

- **Time header** (sticky top): 32 px, `bg-card text-xs text-muted-foreground tabular-nums`, an hour label every four 15-minute columns.
- **Lane column** (sticky start): 220 px at `xl`, 160 px at `md`–`lg`; `bg-card text-sm font-medium`, bay name plus capability icons; inactive bays `text-muted-foreground` with "Inactive".
- **Rows** 56 px. Hour lines `border-border`; quarter lines `border-border/50`; alternating hour bands `bg-muted/40`; closed time and out-of-window time `bg-hatch` (existing utility).
- **Now line** (today only): `w-0.5 bg-destructive` across all rows, with a time label pill at the top `rounded-full bg-destructive px-1.5 text-2xs font-semibold text-destructive-foreground tabular-nums`.
- **Appointment block** (a `button`):
  - `rounded-md border-l-3 border-status-<s>-border bg-status-<s>-bg text-status-<s>-fg px-2 py-1 text-dense`
  - line 1: status icon (`size-3.5`) + service name (`font-semibold truncate`);
  - line 2: plate chip, VIN (if 160 px or wider), then the technician avatar and first name;
  - blocks narrower than 90 px: status icon, service code, avatar;
  - hover `hover:shadow-md transition-shadow duration-150`; focus `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card`; selected (its sheet is open) `ring-2 ring-primary`; just booked `animate-booked` plus `ring-2 ring-ring` for 3 s;
  - `aria-label`: "Interim Service, Bay 1, 09:00 to 10:00, Amelia Clarke, Confirmed"; a `Tooltip` with the full details on hover and focus.
  - Never lower a block's opacity (completed, past or otherwise): it breaks the text contrast. Past time is marked by the hatch and the now line, not by fading blocks.
- **Legend** below the grid: a dot `size-2.5 rounded-full bg-status-<s>-border`, the status icon, and the label, for the five board statuses.

### 11.13 Mobile agenda job cards

Service Hub's kanban card, one per appointment, in a time-ordered list grouped by lane (bay or technician, following the lane toggle). Bay mode:

```
┌▌──────────────────────────────────────────────┐
│▌ 09:00–10:00                            (BO)  │   time range in the dealership zone; technician avatar
│▌ Amelia Clarke                                │   customerName, font-semibold
│▌ [RE21 KLP] WVWZZZ1KZ6W123456                 │   plate chip, VIN
│▌ (▣ Confirmed)  Interim Service · Ben Okafor  │   status badge, service, technician
└───────────────────────────────────────────────┘
```

- **Data**: the card uses only the `ScheduledAppointmentResponse` fields the schedule endpoint returns (`startLocal`/`endLocal`, `status`, `serviceType`, `technician`, `vin`, `registration`, `customerName`) plus the bay it sits under. It never fetches per card: make and model, contact details and notes appear in the details sheet, which fetches `GET /appointments/{id}` when it opens.
- **Lines**: (1) time range `text-dense font-semibold tabular-nums`, the technician avatar (11.9) at the end in bay mode; (2) customer name `text-sm font-semibold truncate`; (3) plate chip (11.8) then the VIN `font-mono text-xs tracking-wide text-muted-foreground truncate` with the full VIN in the card's `aria-label`; (4) status badge (icon and label), then in one `min-w-0 truncate` span the service name `text-dense`, ` · ` and the other resource: the technician's name in bay mode, the bay's name in technician mode (no avatar in technician mode: the lane header already names the technician). Every card therefore names both the bay and the technician, one in the lane header and one on the card.
- `rounded-chip bg-card p-3 shadow-xs ring-1 ring-foreground/10 border-l-3 border-status-<s>-border`; the whole card is the button (at least 44 px tall) that opens the bottom sheet. `aria-label` as on the timeline block: "Interim Service, Bay 1, 09:00 to 10:00, Amelia Clarke, Ben Okafor, Confirmed".
- Lane sections: a sticky lane header (`bg-background/95 backdrop-blur text-sm font-semibold`, count `tabular-nums text-muted-foreground`), collapsible; or a horizontally scrollable row of lane filter pills.
- Today: a "now" divider between cards (`h-px bg-destructive` with the time pill).
- Empty lane, closed day, loading and error states exist on mobile too (section 12).

### 11.14 Dialogs and sheets

- **Dialog** (desktop booking): `rounded-xl bg-popover shadow-xl ring-1 ring-foreground/10`, `sm:max-w-2xl`. Header: title (`h2`) and a two-step stepper. Footer actions right-aligned: **Back** (secondary), **Next** or **Book** (primary).
- **Stepper**: two numbered steps (a real sequence): "1 Service & time", "2 Customer & vehicle". Current step: `bg-primary text-primary-foreground` circle and `aria-current="step"` on the step; done: `bg-success text-success-foreground` with `Check` and the visually hidden word "completed"; upcoming: `border border-input text-muted-foreground`. The step names stay visible on mobile. When the step changes, focus moves to the new step's `h3` (`tabIndex={-1}`), so keyboard and screen-reader users land at the top of the new step.
- **Side sheet** (desktop appointment details): right side, `sm:max-w-md bg-popover shadow-lg`. Header: status icon tile, service name, status badge; then vehicle (section 12.2), customer, bay, technician, times; the cancel form at the bottom (reason `Textarea`, **Cancel appointment** destructive button).
- **Bottom sheet** (mobile details): `SheetContent side="bottom"`, which the sheet recipe (17.3) gives `rounded-t-2xl max-h-[85dvh]` (`bg-popover shadow-lg` as built), a decorative grab handle (`mx-auto h-1.5 w-10 rounded-full bg-muted-foreground/40`), scrollable body, the action row sticky at the bottom with `pb-[max(1rem,env(safe-area-inset-bottom))]` so it stays reachable above the on-screen keyboard.
- **Full-screen booking sheet** (mobile): `SheetContent side="bottom" className="h-dvh data-[side=bottom]:max-h-dvh data-[side=bottom]:rounded-none"` (the overrides carry the same `data-[side=bottom]:` variant as the sheet recipe, so tailwind-merge replaces them; a bare `max-h-dvh` would lose to the recipe's `max-h-[85dvh]`); sticky header with the close button and the stepper; scrolling body; sticky footer with **Back / Next / Book** (`h-11`, safe-area padding). After success it shows the booking-success state (section 12.1) instead of closing, because the board is hidden behind it.
- All dialogs and sheets trap focus and restore it on close (Base UI does this); `Esc` closes; the title is the accessible name.

### 11.15 Toasts

`rounded-2xl bg-popover shadow-lg ring-1 ring-foreground/10`, title `font-semibold`, description `text-muted-foreground`. Success toasts lead with `CircleCheck` in `text-success`; failures with `CircleX` in `text-destructive` (the outcome icons of section 9). The action button is `accent` (Keyloop's cyan toast action): "Booked · Bay 4 · Ben Okafor · 10:00" with **View on board**. Toasts announce politely (`aria-live="polite"`); errors that block the user are alerts, not toasts.

### 11.16 Alerts and problem details

| Situation | Treatment |
|---|---|
| **409** `slot-unavailable` / `slot-conflict` (someone took the slot) | `Alert` with `bg-warning-subtle border-warning/30`; `TriangleAlert` and the title in `text-warning` ("Slot just taken - pick another time"); detail in `text-foreground`; the trace id row; `suggestedSlots` as slot chips (one click re-submits) |
| **409** `concurrency-conflict`, `invalid-state-transition` | same warning treatment, with the problem title and a **Reload** action |
| **422** business rule | warning treatment with the rule title; for `no-qualified-resources` the missing capabilities or certifications as outline badges |
| **400** validation | field errors under each field (`CircleAlert`); a short summary at the top of the step only if a field is off screen (scroll it into view) |
| **404** `not-found` (the dealership or appointment is gone) | warning treatment with the problem title and a **Reload** action (the board refetches; an open details sheet closes) |
| **429** `rate-limited` | info treatment: `bg-info-subtle border-info/30`, `Clock` and the title in `text-info`, "Too many requests - try again in N s" from `Retry-After` (or `retryAfterSeconds`), the trace id row; the retry action stays disabled until then |
| **401** `unauthenticated`, **403** `forbidden` | the session dialog (11.20) once for the app, with Sign in (401) or Close (403); in place, warning treatment titled in the operation's words ("Couldn’t book: you’re signed out", "… your role doesn’t allow it") |
| any other 4xx (for example a framework `413`) | warning treatment with the problem title and status code, and the trace id row if present |
| **5xx** or network failure | `ProblemAlert` (existing): `bg-card text-destructive`, `CircleX`, the summary, trace id and **Try again**. A whole-board failure uses the error-connection state (section 12.1) |

Every problem shows its `traceId` (copyable) so it can be found in the Aspire dashboard.

### 11.17 Tables

- **Table**: header row `h-9 bg-muted/50 text-xs font-medium text-muted-foreground`; rows `h-11 border-b border-border`; numbers right-aligned with `tabular-nums`; mono for slugs and trace ids. Row hover `hover:bg-muted/50`.
- **Appointments table** (the Appointments page, adopted from the template's tasks data table):
  - Each row's first cell carries the status marker bar (the 3 px `-border` colour of 11.12, drawn as a `before:` bar inside the cell), so the list reads as the board's status map; the first column's text starts 16 px from the card's edge, in line with the card header and toolbar.
  - Sortable headers are compact ghost buttons (`text-xs font-medium text-muted-foreground`, `ArrowUp` / `ArrowDown` / `ChevronsUpDown` at `size-3.5`); the header cell carries `aria-sort`.
  - Cells `px-1.5`; the row's actions are a ghost `icon-sm` button (`MoreHorizontal`) opening a menu (*View details*, then the destructive *Cancel appointment*, unavailable once work has started); the whole row is a click target for the details sheet, with the actions button as the keyboard path.
  - Faceted filters: dashed outline `sm` buttons with `PlusCircle`, the chosen values as secondary badges; the popover is a checkbox list, each choice with its count (`text-xs text-muted-foreground tabular-nums`, read as "Bay 1 - Standard (3 appointments)"), and a ghost *Clear filter*. Status choices lead with the status dot.
  - Width: columns the card cannot hold are left out by default (Duration below 1536 px, VIN below 1440 px; *View* brings them back). Where it still overflows (below 1024 px) the table scrolls inside its card, and the time column stays put: `sticky left-0` on an opaque fill that repeats the row's tint (`color-mix` of `--muted` over `--card`), with a hairline `inset -1px 0 0 var(--border)` on its right edge.
  - Below 768 px the table becomes job cards (11.13) in the table's order, each naming both the bay and the technician, and the filters move into a *Filters* bottom sheet (sort, then one fieldset per filter, a sticky footer with *Reset filters* and *Show N appointments*).
- **Resource tables** (Technicians, Bays, Services; the users app adopted, 11.19): the appointments table's anatomy without the status bar (a resource has no appointment status): sortable compact headers with `aria-sort`, 44 px rows, numbers right-aligned in `tabular-nums`, the first column sticky while the table scrolls inside its card, the same toolbar, faceted filters (each choice with its count, read as "MOT tester (2 technicians)") and *View*. Identifiers are monospace (employee number, service code). Capabilities and certifications are the board's badges (11.6), two then `+n`; a need the dealership lacks is an outline badge after a dashed *No* pill, and a need that exists but not on one bay or technician is said in words ("Not all on one technician"). Whether a technician takes bookings or a bay is in service is a quiet `secondary` pill (*Active*, *In service*) or the board's dashed pill (*Inactive*, *Out of service*), never a colour. Today's booked time is the thin `chart-1` meter of section 13 beside the time ("2 h 15 min") or the share ("45%"), *Closed* on a closed day. The services code is left out below 1536 px, so every resource table fits its card from 1024 px up. The table keeps a row-actions slot (a trailing menu cell, Task 30); until then no control edits anything. Below 768 px each row is a read-only card (`rounded-chip bg-card p-3 shadow-xs ring-1 ring-foreground/10`, the name an `h3`) with the same *Filters* sheet.

### 11.18 Skeletons

`bg-muted rounded-md animate-pulse` in the shape of what is loading: four KPI tiles; the timeline as lane rows with two or three block-shaped bars each; agenda cards on mobile. Skeletons appear after 150 ms (no flash on fast loads), carry `aria-busy="true"` on the region and a visually hidden "Loading schedule". With reduced motion they are still shapes.

### 11.19 Adopting the template's apps

The template-adoption addendum of tasks 16 and 17 copies files from the shadcn dashboard template. Copy them, then adapt them to this system as follows; nothing from the template's demo styling ships unchanged.

| Template file | Becomes | Adapt |
|---|---|---|
| `dashboard/components/section-cards.tsx` | KPI strip (11.11) | Delete the wrapper's `*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:bg-gradient-to-t` classes (principle 6: no gradients on cards) and use `Card size="sm" className="shadow-xs"`. Delete the `TrendingUp`/`TrendingDown` badges and the trend footer: the API has no history, so a trend would be invented. `CardAction` holds the optional status icon tile (11.10) or, on a tally tile, the outcome tile (11.17). The figure uses the 11.11 classes, not the template's `CardTitle text-2xl font-semibold`. |
| `calendar/components/calendars.tsx` | the lane filter (bays or technicians) | No colour dots and no `text-white`: lanes have no colour, because hue is reserved for status (principle 2, section 13). Each lane row: a `Checkbox` (17.3), the lane name, its capability icons (`Zap`, `Ruler`) and its appointment count in `tabular-nums text-muted-foreground`. Desktop: a toolbar popover or collapsible panel; mobile: inside the Filters sheet. |
| `calendar/components/date-picker.tsx`, `calendar-sidebar.tsx` | the date control (11.4) and the Book action | Selected day `bg-primary text-primary-foreground`, today `ring-1 ring-signal`, closed days disabled and `line-through`. The sidebar's quick action becomes **Book appointment**: the view's one primary button (the floating accent action on mobile). |
| `calendar/components/calendar-main.tsx` (list view) | the mobile agenda (11.13) | Regroup by lane; each row becomes the 11.13 job card; drop the template's event colours. |
| `tasks/components/data-table*.tsx`, `columns.tsx`, `lib/data-table.ts` | the Appointments table (11.17) | TanStack Table 9 as the template has it, without row selection (nothing acts on several rows). The faceted filter's command palette becomes a plain checkbox list with counts (a day has a handful of choices); the toolbar's three selects become faceted filters; the view menu names columns by `meta.label`, not by id; pagination shows only when the rows outnumber the smallest page, and each page button keeps focus when it disables itself. The template's priority colours (`border-gray-500` and so on) and sample data are not kept. |
| `users/components/stat-cards.tsx` | the Appointments page's four figures (11.11) | The 11.11 card anatomy instead of the template's icon-above-title layout; no trend badges or "from previous" lines (no history to compare with); the completed and no-show cards carry their status's icon tile, the total a thin bar of the day by status in the status markers (section 13). |
| `calendar/components/event-form.tsx`, `users/components/user-form-dialog.tsx` | the booking dialog (11.14) | Keep the react-hook-form, zod and `Field` structure: labels above, help and errors below (11.4). The stepper (11.14) and the slot chips (11.6) replace the template's free date and time inputs. |
| `dashboard/components/chart-area-interactive.tsx` (only if adopted) | the latency chart | `chart-1` only, a flat fill or a line instead of the template's gradient fill, axis and tick text `text-muted-foreground`, and the values also written out (section 13). |
| `users/page.tsx`, `users/components/data-table.tsx`, `users/components/stat-cards.tsx` | the resources pages (Technicians, Bays, Services) and their figures | The 11.17 resource-table anatomy over the shared data table parts (the template's select filters become faceted filters, its row selection, image avatars, role and status colours and add-user form are not kept), four 11.11 figure cards per page without trends, cards on a phone. Read-only: the row-actions slot stays empty until Task 30. |
| `settings/appearance/page.tsx` | Appearance (`/settings/appearance`) | The theme only, as a radio group of cards (11.6's card anatomy) with a miniature of the board in each theme's tokens instead of the template's grey sketches; applies at once, so no Save button; the font, sidebar-width and content-width selects are not kept (the design system fixes them). |
| `settings/account/page.tsx` | Account (`/settings/account`), from `GET /me` (11.20) | The account as a card: initials avatar (`lg`), name, email and role badges, then "What you can do" as a list of four rows, each with `CircleCheck` in `text-success` or `CircleMinus` in `text-muted-foreground` and the visually hidden answer ("Yes:", "No:"), and Sign out (outline) or Sign in (primary) in the footer. On the development server a second card says how to change the configured identity. The template's profile, password and delete-account forms are not kept: the account lives with Cloudflare Access. |
| `errors/unauthorized`, `errors/forbidden`, `errors/internal-server-error`, `errors/under-maintenance` | the 401, 403, 500 and 503 pages | The 12.1 layout in the shell, as the 404, each with its own wave-2 picture: a headline in words (no numeric headline), one or two lines, one action (*Sign in* or *Go to the dispatch board*, *Try again* when the sending page passed itself); the template's placeholder image and "Contact Us" are not kept. |
| `errors/not-found` | the router 404 page | The 12.1 layout with `not-found.webp`: headline "Page not found", one line naming the path (`font-mono`), action **Go to the dispatch board** (primary). |
| `errors/internal-server-error` | the router error boundary | The 12.1 layout with `error-connection.webp`: headline "Something went wrong", the trace id row when the error carries one, action **Try again** (primary), which reloads the route. |

### 11.20 Sign-in, roles and refusals

The app says who may do what before anything is sent, from `GET /me` (ARCHITECTURE §15): a visitor who is not signed in is asked to sign in, a role that cannot do a thing sees it unavailable with the reason, and the API stays the judge of every request. There is never a password form: signing in and out are plain links to the API's Access URLs.

**User menu** (`components/nav-user.tsx`, the template's nav-user in the sidebar footer, 11.1):

| State | Row (`SidebarMenuButton size="lg"`) | Menu (`DropdownMenuContent`, `min-w-60`) |
|---|---|---|
| checking (until `/me` answers) | `Skeleton` avatar, "Checking sign-in…" in `text-muted-foreground`, `aria-busy` | the theme group only |
| not signed in | `UserRound` avatar, "Not signed in", "Customer details masked" (`text-xs text-muted-foreground`) | a label ("Sign in with a workshop account to book, cancel and see customer details."), **Sign in** (`LogIn`), **Account** |
| `/me` failed | "Sign-in not checked", same second line | the label says the app treats you as signed out; **Try again**, **Sign in**, **Account** |
| signed in | `InitialsAvatar` (from the name, else the email's local part), the name (else the email), the role names joined by commas ("No role yet" without one) | the group's label: name (`text-sm font-semibold`), email, `RoleBadges` (outline badges with `ShieldCheck` Admin, `Wrench` Service advisor, `Eye` Viewer; "No role" muted); then **Account** and **Sign out** (`LogOut`, a link to `logoutUrl`) |

The theme radio group stays at the bottom of every menu (phones have no header toggle). Items are `pointer-coarse:min-h-11`; links are `DropdownMenuLinkItem` (Base UI `Menu.LinkItem`): Sign in and Sign out navigate the whole page, Account is a router `Link`. On a phone the row is in the sidebar sheet's footer.

**Sign-in prompt** (`components/auth/sign-in-prompt.tsx`, `SignInPrompt`): what a visitor who is not signed in gets from **Book appointment** (the toolbar's, an empty day's and the phone's floating action) instead of the booking dialog, before anything is typed, so no booking is half-entered and then lost to the sign-in's navigation. A `Dialog` (`sm:max-w-md p-0 gap-0`): a centred column (`px-6 pt-8 pb-6`) with `sign-in-to-book.webp` (`w-40 md:w-48`, described: it shows what the headline does not), the title "Sign in to book" (`font-heading text-lg font-semibold`), one paragraph ("Booking needs a workshop account with the Admin or Service advisor role. Anyone can view the board, with customer details masked."), then the dialog footer with **Not now** (outline) and **Sign in** (primary, `LogIn`). Sign in takes focus as it opens; Not now, Escape or the close button give focus back to the Book action that opened it. Below `sm` the footer stacks the actions at full width, Sign in on top.

**Sign-in panel** (`SignInPanel`): the same request inside a view that is already open, the details sheet: `rounded-xl border border-border bg-card p-4`, the picture at `w-24` beside (from `sm`) or above the `h3` "Sign in to see the whole booking", one line ("Contact details, the vehicle and cancelling need a workshop account. Until then, names, VINs and plates are masked.") and **Sign in** (`sm`). It stands in for the record and for the cancellation form, and the record is not requested, so there is no `401` and no error state.

**Sign in** (`components/auth/sign-in-action.tsx`) is a link styled as a button: a top-level navigation to `/auth/login` on the app's own origin with `returnTo` set to the current path and search (the dealership and day come back with the user), or `/` when that is not a local path (`lib/session.ts` `safeReturnTo`: one leading `/`, not `//`, no backslash, no control character). The `loginUrl` that `/me` or a `401` problem carries is never followed. Its classes go through `cn()`: `buttonVariants` alone only concatenates, so an outline link would keep the base's `border-transparent` and lose its border.

**Disabled with reason**: for a signed-in account whose role cannot do it (a Viewer; an account without a role), a control that changes bookings stays on screen, unavailable but focusable (`disabled` with Base UI's `focusableWhenDisabled`, which renders `aria-disabled`), and names its reason with `aria-describedby`; the reason is visible too, never only a tooltip. The reason is `WriteReason` (`components/auth/write-reason.tsx`): `flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-foreground` with `Eye` in `text-muted-foreground`.

| Where | Control | Reason placed |
|---|---|---|
| dispatch board | **Book appointment** (toolbar, empty day, phone's floating action) | one note under the toolbar, named by every Book action |
| details sheet | **Cancel appointment** (destructive, unavailable; no reason field to fill) | above it, in the sheet's footer |
| appointments list | the row menu's **Cancel appointment** (dimmed item) | a `text-xs text-muted-foreground` line under the item, outside it so it keeps full contrast |
| booking dialog | **Book**, **Suggest a service** and the photo input, when the identity changes while it is open | a note above the footer; signed out, it says what was typed is not kept and adds **Sign in** (outline, `sm`) |

The words: "Your role can view bookings but not change them." for a Viewer; "Your account has no workshop role yet, so it can view the board but not change bookings. The workshop administrator assigns roles." for an account without a role. The board and the appointments list wait for `/me` as they wait for their first reads, so a Book action never shows usable and then turns unavailable, and the note never pushes the board down after it has drawn.

**Refusals the UI did not foresee** (`components/auth/session-watch.tsx`, mounted once in the root layout): a `401` or `403` from any read or write opens one dialog (`sm:max-w-md p-0`, no close button: each answer has its own way out, and Escape), and `/me` is read again. A `401` says "Your session has ended" (or "Sign in to continue" when nobody was signed in), "Sign in again to carry on. Anything not yet saved on this page, such as a booking being entered, will need entering again.", the trace id row, then **Not now** (outline) and **Sign in** (primary, focused; `/auth/login` coming back to this page, never the problem's own `loginUrl`). A `403` says "Your role doesn’t allow that" and that roles are assigned by the workshop administrator, with **Close** (primary, focused). The first refusal of a burst is the one answered. In place, the view's own alert titles the refusal in the operation's words ("Couldn’t cancel the appointment: you’re signed out", "… your role doesn’t allow it") as a warning, never the problem's JSON or the catalogue's "Authentication required".

**The development server** (the Vite dev server fronts the API's Development identity, which is configuration): no login page exists and the Access logout is not served, so nothing offers them. Sign in becomes **How to sign in** (`Info` icon) to Settings > Account, whose second card lists the `Auth__Development__Roles__0` settings (with copy buttons) and the AppHost parameter; signed-in menus put "Signed in by this development server's configuration, so there is no sign-out here." inside the group's label (so it is read with the items) and offer no Sign out. Prompts add one muted line: "On this development server the API's configuration decides who you are, so there is no sign-in page."

## 12. Illustrations, empty and error states

### 12.1 State illustrations

Original artwork generated for this project with OpenAI image generation through Codex: no third-party marks, no text, people or vehicle badges (prompts and provenance in the images README kept with the design working files). Copy the eight `.webp` files to `src/assets/illustrations/` and import them so Vite fingerprints them (each is larger than Vite's 4 KB inline limit, so none becomes a `data:` URI). A second set of ten (wave 2, same pipeline and style, its own README with prompts, alt text and verification) adds a picture per error page, the empty roster, the triage photo field, the sign-in prompt and two for later tasks; the eight in use are copied the same way, and `empty-calendar.webp` and `dashboard-insights.webp` wait for the calendar and overview (Task 28b). State illustrations are registered once, with their alt text, in `src/lib/illustrations.ts`: that module holds only their fingerprinted addresses, so a picture is downloaded when a state that shows it renders. The illustrations have a transparent background, with at least 24 px of transparent margin, that reads on light and dark cards; do not put them on a coloured panel.

| File | Pixels, bytes | State | Headline (example) | Action |
|---|---|---|---|---|
| `empty-schedule.webp` | 1200 × 900, 103 KB | open day, no appointments | "No appointments on Tuesday 13 October" | **Book appointment** (primary) |
| `closed-day.webp` | 1200 × 900, 114 KB | the dealership is closed that day | "Reading is closed on Sunday" + "The workshop opens again on Monday 19 October." | **Go to next open day** (signal) |
| `no-availability.webp` | 1200 × 900, 108 KB | booking step 1: no slot for the service and day | "No free slot for Full Service" + the API's `unavailableReason` | **Try Wednesday 14 October** (signal) |
| `error-connection.webp` | 1200 × 900, 82 KB | the schedule could not load at all (network, 5xx) | "Couldn’t load the schedule" + summary + trace id | **Try again** (primary) |
| `booking-success.webp` | 1200 × 900, 151 KB | mobile full-screen booking sheet after success | "Booked" + service · bay · technician · time | **View on board** (primary), **Book another** (secondary) |
| `error-connection.webp` | (reused) | router error boundary (11.19) | "Something went wrong" + trace id if any | **Try again** (primary) |
| `unauthorized.webp` | 1200 × 900, 106 KB | 401 page | "Sign in to continue" + what needs an account | **Sign in** (primary), back to the page that needed it; *How to sign in* on the development server |
| `forbidden.webp` | 1200 × 900, 114 KB | 403 page | "No access to this page" + roles come from the workshop administrator | **Go to the dispatch board** (primary) |
| `not-found.webp` | 1200 × 900, 93 KB | 404 page and the router's `*` route (11.19) | "Page not found" + the path | **Go to the dispatch board** (primary) |
| `server-error.webp` | 1200 × 900, 156 KB | 500 page, also for every other 5xx but 503 | "Something went wrong on the server" + trace id if any | **Try again** on the sending page, else **Go to the dispatch board** |
| `maintenance.webp` | 1200 × 900, 156 KB | 503 page | "Down for maintenance" + bookings kept | **Try again** on the sending page, else **Go to the dispatch board** |
| `empty-technicians.webp` | 1200 × 900, 106 KB | Technicians and Bays lists of a dealership with none yet (11.17) | "No technicians yet" / "No bays yet" + one line | **Check again** (outline) |
| `photo-evidence.webp` | 1200 × 900, 131 KB | the triage photo field in the booking dialog's step 1 (11.14), before the first photo | no headline: the field's label, then "A photo of the warning light, the damage or the paperwork helps find the right service." | the file input itself |
| `sign-in-to-book.webp` | 1200 × 900, 123 KB | the sign-in prompt before booking, and the details sheet's sign-in panel at `w-24` (11.20) | "Sign in to book" / "Sign in to see the whole booking" + what needs an account | **Sign in** (primary), with **Not now** in the prompt |

Layout: a centred column inside the card or panel, `flex flex-col items-center gap-3 py-8 text-center`; the image `w-40 md:w-48 h-auto` with `width`/`height` attributes set to the file's pixels (no layout shift); headline `h3` (`font-heading text-lg font-semibold`; `h1` on the router error pages, which have no other title); one line of `text-sm text-muted-foreground` (`max-w-xs`); one action. Desktop booking success stays a toast (Addendum B §B4); only the mobile full-screen sheet uses the success illustration.

Every error page has its own picture, so none needs telling apart: the icon tiles that once marked a shared `closed-day.webp` on the 401, 403 and 503 pages are gone. The Services list keeps `empty-schedule.webp` for an empty catalogue; the empty locker is for the people and bays a workshop has not set up.

The triage photo field is the one illustration inside a form. Before the first photo the field is a dashed panel (`rounded-lg border border-dashed border-input p-3`, no fill): the picture at `w-20 sm:w-24` (`width`/`height` set as above) beside one line of `text-sm` saying what is worth photographing, the file input under them on a phone and beside the picture from `sm`. Once a photo is chosen the panel and the picture go and the field shows the input and the photo list; the input stays the same element, so focus that returns from the file picker stays in the dialog.

Do not use illustrations for inline problems (409, 422, 400, 429): those are alerts in place, next to what the user is doing.

### 12.2 Vehicle placeholder

`vehicle-placeholder.webp` (960 × 640, 94 KB, transparent): the vehicle row in the appointment details sheet, `w-28 h-auto` beside make and model (`font-heading font-semibold`, from `GET /appointments/{id}`), the plate chip and the VIN. It stands for "this vehicle" generically; never caption it as the customer's actual car.

### 12.3 Header band

`backdrop-light.webp` and `backdrop-dark.webp` (2400 × 800, 55 KB and 56 KB, opaque): a soft OWNERSHIP glow (light, top-left, it picks up the domain tag) and a dim fusion-blue-to-violet aurora (dark, right). Used **once**, on the dispatch board, behind the 56 px header only: the band is 80 px tall and fades out over its last 24 px, so the page title, toolbar and cards sit on the plain work surface.

```tsx
<img src={backdropLight} alt="" aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-20 w-full select-none object-cover object-left-top mask-b-from-70% dark:hidden" />
<img src={backdropDark} alt="" aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 hidden h-20 w-full select-none object-cover object-right-top mask-b-from-70% dark:block" />
```

The work surface is `relative overflow-hidden`; the header is `relative`. The band scales to the work surface's width, so the 56 px header covers the image's top 56 × 2400 / width source rows: about 115 rows on a 1168 px surface, 420 rows on a 320 px phone. Measured over every pixel of those rows at every width from 320 px:

| On the band | Light band | Dark band | Verdict |
|---|---:|---:|---|
| `text-foreground` | 8.52:1 | 7.05:1 | allowed: the product title, the wordmark, icons |
| `text-muted-foreground` | 3.59:1 | 3.73:1 | **not allowed** (fails 4.5:1 at the light band's lavender peak, `#d8c2f0`) |
| `ring` (focus) directly on the band | 2.42:1 | 3.04:1 | **not allowed** bare: use the offset rule below |
| `input` (a field or outline-button boundary) | 2.23:1 | 1.99:1 | **not allowed**: no bordered fields or outline buttons on the band |

Figures from ffmpeg's WebP decoder. Other decoders (macOS `sips`, Pillow) give pixel values a step or two apart, which moves these figures by up to 0.07 (the dark band's `#f1f1f3` measures 6.98:1 to 7.05:1), so treat the second decimal as noise: navy is 8.5:1 or more, `#f1f1f3` 6.9:1 or more.

- The domain tag brings its own fill. Its lavender first stop meets the light band's lavender peak, so its edge is soft by design; it is not interactive, so 1.4.11 does not apply.
- Ghost icon buttons (sidebar trigger, theme toggle) on the band add `focus-visible:bg-background focus-visible:ring-offset-2 focus-visible:ring-offset-background`. The 1 px `border-ring` then has the background colour on both sides (3.9:1 light, 6.8:1 dark), instead of the band (2.4:1 at the light band's lavender).

Decorative: empty `alt`, `aria-hidden`.

### 12.4 Alt text

The images READMEs are not copied into the web project, so the alt text lives here and, for the state illustrations, in `src/lib/illustrations.ts`. The first set's states have a headline that already says what the picture shows, so their image is decorative: `alt=""`. The wave-2 pictures are each state's own and show what the words do not (a key and an open padlock for sign-in, a barrier for no access, a closed road, an open bonnet, a car on a lift, an empty locker, a phone photographing a warning light, a booking card beside a car key), so they carry the alt text below (`described` on `IllustratedState`; the error pages and the empty Technicians and Bays lists always, the photo field's picture, and the sign-in prompt and panel). Use the first set's alt text only where an illustration appears without an equivalent heading.

| File | Alt text |
|---|---|
| `empty-schedule.webp` | Empty workshop service bay with a two-post lift and a blank calendar. |
| `closed-day.webp` | Closed workshop shutter beneath a crescent moon and stars. |
| `no-availability.webp` | Magnifying glass over a calendar with every slot filled. |
| `error-connection.webp` | Disconnected cable plugs beneath a coral warning triangle. |
| `booking-success.webp` | Silver hatchback with a green check mark and lavender-to-peach sparks. |
| `vehicle-placeholder.webp` | Generic silver hatchback viewed from the front at an angle. |
| `unauthorized.webp` | Car key fob beside an open padlock inviting sign-in. |
| `forbidden.webp` | Workshop bay behind a safety barrier with a wrench role badge. |
| `server-error.webp` | Generic silver hatchback with an open bonnet, a steam wisp and a nearby wrench. |
| `maintenance.webp` | Silver hatchback raised on a two-post lift beside cones and a progress indicator. |
| `not-found.webp` | Directional road sign pointing toward a short road closed by a barrier. |
| `empty-technicians.webp` | Tool pegboard beside an open, empty technician locker. |
| `photo-evidence.webp` | Phone camera framing an amber warning triangle on a generic vehicle dashboard. |
| `sign-in-to-book.webp` | Calendar booking card beside a car key. |
| `backdrop-light.webp`, `backdrop-dark.webp` | decorative: `alt=""` and `aria-hidden="true"` always |

## 13. Data visualisation

- **Categorical palette**, fixed order, never cycled: `chart-1` signal blue, `chart-2` ownership amber, `chart-3` hyper violet, `chart-4` operate teal, `chart-5` energy coral. Validated with the data-viz palette validator in both themes (lightness band, chroma floor, adjacent colour-vision ΔE 13.3 light / 12.9 dark, normal-vision ΔE 25.3 / 23.4, every mark 3:1 or more on its card).
- **Status colours are reserved** for status: a chart of appointments by status uses the status markers (`bg-status-<s>-border`) with icons and labels, never `chart-*`; a chart of anything else never uses status or feedback colours.
- **Tallies and outcome bars** use the feedback tokens (success, warning, destructive) as in section 11.17.
- Marks are thin, with a 2 px surface gap between adjacent fills; numbers and labels use text tokens (`text-foreground`, `text-muted-foreground`), never the series colour; a legend appears for two or more series; a table view or written values exist for every chart.
- The KPI strip is numbers, not charts. Bay utilisation may add a thin meter (`h-1.5 rounded-full bg-muted` track, `bg-chart-1` fill) under the figure. The resources pages use the same meter for each technician's and bay's booked share of today's opening hours, beside the time or percentage it draws. The same meter, `aria-hidden` under the written percentage, compares the suggested services' probabilities (11.6).

## 14. Responsive rules

Breakpoints are Tailwind's defaults. The binding behaviour comes from the "responsive and mobile view" controller addendum of tasks 16 and 17; this section restates it as design rules.

| Range | Layout |
|---|---|
| **≥ 1280 px** (`xl`) | Full layout (§B4): expanded sidebar, four KPI cards in a row, timeline with a 220 px lane column, toolbar on one row. |
| **768–1279 px** (`md`–`lg`) | Sidebar off-canvas (opened from the header); KPI cards 2 × 2 at `md`, 4-up at `lg`; the timeline scrolls horizontally inside its card with a sticky 160 px lane column and sticky time header; the toolbar wraps onto two clean rows. |
| **< 768 px** (mobile) | Sidebar is the off-canvas sheet; KPI 2 × 2 compact tiles; toolbar = dealership select (full width), date control with previous/next, lane toggle, and a **Filters** sheet for auto-refresh and the legend; **the board is the agenda** (section 11.13); details open as a bottom sheet; booking is a full-screen sheet; Book is a floating action. |

Rules at every width:

- No horizontal page scroll. Only the timeline scrolls sideways, inside its card.
- Touch layouts (`pointer-coarse`) get 44 × 44 px targets: buttons, chips, tab triggers, nav items, calendar days, icon buttons.
- Fixed and bottom UI respects `env(safe-area-inset-*)`.
- Text never overflows its box: truncate with a tooltip or `aria-label` carrying the full value.
- **Floating Book action** (mobile only): `fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 h-14 rounded-full px-5 bg-brand-accent text-brand-accent-foreground shadow-lg ring-6 ring-brand-accent/25` with `Plus` (`size-6`) and the word **Book** (`aria-label="Book appointment"`). The agenda gets `pb-24` so the last card is not hidden behind it.
- Check at 375 × 812, 390 × 844, 768 × 1024, 1024 × 768 and 1440 × 900, in light and dark.

## 15. Accessibility

Target: **WCAG 2.2 AA**, in both themes.

- **Contrast**: every pair in section 4.4. Do not introduce a text colour, tint or opacity modifier on text without adding its row to the audit and the test (section 17.4).
- **Focus**: visible on every interactive element, in one colour (`--ring`, 3:1 or more on every surface, section 4.4). Controls use shadcn's 1 px `border-ring` plus the 3 px signal halo, on every variant (11.2); links use a 2 px `outline-ring` with a 2 px offset (11.3); borderless targets (blocks, cards, chips) use `ring-2 ring-ring ring-offset-1` (offset in the surface colour). The base layer makes the solid ring every element's default outline colour, so an outline that names no colour still passes. Focus is never removed without a replacement.
- **Colour is never the only signal**: statuses carry icon and label; feedback carries icon and words; links in text are underlined; the active nav item has the 3 px bar and weight; charts have labels or a table.
- **Targets**: at least 44 × 44 px on touch; at least 24 × 24 px with spacing on desktop (2.5.8).
- **Keyboard**: everything reachable in a logical order; the timeline blocks are buttons in DOM order (lane, then time); `Esc` closes overlays; the skip link stays first.
- **Names and announcements**: blocks have full `aria-label`s; icon-only buttons have `aria-label` and a tooltip; toasts are polite live regions; problem alerts are `role="alert"`; loading regions set `aria-busy`.
- **Motion**: `prefers-reduced-motion` respected (section 10).
- **Language and time**: `lang="en-GB"`; dates and times in the dealership's time zone with the zone named once on the page ("Times in Europe/London").

## 16. Do and don't

| Do | Don't |
|---|---|
| Use semantic utilities: `bg-card`, `text-muted-foreground`, `border-input`, `bg-status-in-progress-bg`. | Use hex, `rgb()`, `oklch()` or Tailwind palette colours (`bg-blue-500`, `text-slate-600`) in components. |
| One primary (carbon or white) button per view. | Put two primary buttons side by side, or use the cyan accent as a second primary. |
| Show status as icon + label + hue. | Show status by colour alone, or invent a new status colour. |
| Keep the OWNERSHIP gradient in the header tag. | Use gradients on cards, buttons, charts, headings or backgrounds. |
| Use `text-muted-foreground` for secondary text. | Fade text with `opacity-*` or `text-foreground/50`; it fails contrast. |
| Mark controls with `border-input`; hairlines with `border-border`. | Draw field outlines with `border-border` (1.3:1, invisible to many). |
| Use `tabular-nums` for times and counts. | Let ticking numbers jitter. |
| Write plain workshop words: Bay, Technician, Book appointment, "Slot just taken - pick another time". | Use system words (resource, entity, 409 Conflict) as the headline; the slug belongs in the detail. |
| Keep the action's name through the flow: **Book** → toast "Booked". | Say "Submit", "OK" or "Success!". |
| Use the illustrations for whole-view empty and error states. | Put illustrations in inline alerts, toasts or table rows. |
| Write "Keyloop" as text, and keep the "Take-home demo · not an official Keyloop product" line in the sidebar footer. | Recreate Keyloop's logo or use its images, or link the wordmark to keyloop.com. |
| Keep one focus colour on every control. | Recolour focus per variant (the shipped red focus at 40 % was 2.1:1). |
| Put `bg-overlay` behind dialogs and sheets. | Use `bg-black/*` or `bg-white/*` for scrims. |
| Adapt adopted template files to these tokens (11.19). | Ship the template's gradient KPI cards, trend badges or colour-dot lane filters. |

## 17. How to apply (for engineers)

### 17.1 Adopting the theme

Paths are relative to `src/Keyloop.ServiceScheduler.Web` unless they start with `docs/` or `design/`.

1. Copy this file to `docs/UI_DESIGN.md`.
2. Apply `keyloop-theme.css` to `src/index.css` exactly as its header says (steps A to G: replace the `@theme inline`, `:root`, `.dark` and `@layer base` blocks; add the `@layer components` block; keep the rest).
3. Swap the fonts (header step H): replace the Inter import in `src/main.tsx` with the four imports in section 5.1, then `pnpm remove @fontsource-variable/inter` and `pnpm add @fontsource-variable/plus-jakarta-sans@^5.3.0 @fontsource-variable/ibm-plex-sans@^5.3.0 @fontsource/ibm-plex-mono@^5.3.0`.
4. Keep fonts out of the CSS bundle (header step I). In `vite.config.ts`, add to the object the `defineConfig` callback returns:
   ```ts
   build: { assetsInlineLimit: (file: string) => (/\.woff2?$/.test(file) ? false : undefined) },
   ```
   `false` never inlines a font; `undefined` keeps Vite's 4 KB rule for everything else. Without it, Vite inlines the Plus Jakarta Sans cyrillic-ext subset as a `data:` URI, which the production CSP (`font-src 'self'`) blocks.
5. In the attribution notices (since 2026-10-12 the README's licence section), replace the whole `## Inter typeface` section with these three sections (header step J):
   ```markdown
   ## Plus Jakarta Sans typeface

   Source: https://github.com/tokotype/PlusJakartaSans, packaged as `@fontsource-variable/plus-jakarta-sans`; the font
   files are served from the build output. SIL Open Font License 1.1, Copyright 2020 The Plus Jakarta Sans Project
   Authors. The full licence ships with the package (`node_modules/@fontsource-variable/plus-jakarta-sans/LICENSE`).

   ## IBM Plex Sans typeface

   Source: https://github.com/IBM/plex, packaged as `@fontsource-variable/ibm-plex-sans`; the font files are served from
   the build output. SIL Open Font License 1.1, Copyright 2019 IBM Corp. The full licence ships with the package
   (`node_modules/@fontsource-variable/ibm-plex-sans/LICENSE`).

   ## IBM Plex Mono typeface

   Source: https://github.com/IBM/plex, packaged as `@fontsource/ibm-plex-mono`; the font files are served from the build
   output. SIL Open Font License 1.1, Copyright 2017 IBM Corp. The full licence ships with the package
   (`node_modules/@fontsource/ibm-plex-mono/LICENSE`).
   ```
6. Copy the eight `design/images/*.webp` files, and the wave-2 files in use (12.1), to `src/assets/illustrations/` (the alt text is in section 12.4).
7. Apply the component recipes in 17.3.
8. Verify: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`; then `grep -c "data:font" dist/assets/*.css` prints 0 for every file; the two `rg` checks in 17.2 print nothing; then look at the board in both themes at the five viewports of section 14.

### 17.2 Rules

- **Semantic tokens only.** No raw colours in components, ever. Run both checks from the web project directory; both must print nothing:
  ```bash
  # colour literals (generated API code and tests, which hold oklch() fixtures, are excluded)
  rg -n --glob '*.{ts,tsx}' --glob '!**/*.gen.ts' --glob '!**/*.test.ts' -e '#[0-9a-fA-F]{3,8}\b' -e 'rgba?\(' -e 'oklch\(' -e 'hsla?\(' src
  # Tailwind palette colours, white and black, and the brand reference variables
  rg -n --glob '*.{ts,tsx}' --glob '!**/*.gen.ts' -e '\b(bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|shadow|divide|placeholder|caret|accent)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\b' -e '\b(bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|shadow|divide|placeholder|caret|accent)-(white|black)\b' -e 'var\(--(kl|domain)-' src
  ```
  Both scan `.ts` as well as `.tsx` (the status map is a `.ts` file). Today the second prints the two vendored scrims (`bg-black/10` in `sheet.tsx` and `dialog.tsx`); the 17.3 recipe replaces them with `bg-overlay`.
- **Arbitrary values**: never a literal colour, radius, shadow or type size (`text-[11px]`, `rounded-[7px]`, `shadow-[0_2px_4px_#000]`). Use the scale or a token: `text-2xs`, `text-wordmark`, `rounded-chip`, `shadow-[inset_3px_0_0_var(--signal)]`. Layout values are fine: `max-h-[85dvh]`, `pb-[max(1rem,env(safe-area-inset-bottom))]`, grid templates, and an `em`-relative size for inline code inside running text (`text-[0.9em]`).
- **Fonts through utilities**: `font-heading`, `font-sans` (default), `font-mono`; never `font-family` in components.
- **Radii through the scale**: `rounded-md`, `rounded-lg`, `rounded-chip`, `rounded-xl`, `rounded-2xl`, `rounded-full`.
- **Shadows through the scale**: `shadow-xs` to `shadow-xl`.
- **Status through helpers**: keep one map in `src/app/dispatch/lib/status.ts` from API status to `{ label, icon, classes }` so every view shows the same word, icon and tokens. Outcomes (201, 409, 5xx, 429, other) get the same treatment from one map (11.17).

Class cheat sheet:

| Need | Classes |
|---|---|
| Page text / secondary text | `text-foreground` / `text-muted-foreground` |
| Card | `bg-card text-card-foreground rounded-xl ring-1 ring-foreground/10` |
| Quiet fill | `bg-muted` (`bg-muted/40` for hour bands, `/50` for table headers) |
| Field boundary | `border border-input` |
| Divider | `border-border` |
| Focus on a borderless target | `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card` |
| Link | `text-signal underline underline-offset-4 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring` |
| Text on a selected (`bg-primary`) chip or pill | `text-primary-foreground`; secondary line `text-primary-foreground/80` |
| Success / warning / error / info banner | `bg-success-subtle text-success` / `bg-warning-subtle text-warning` / `bg-destructive-subtle text-destructive` / `bg-info-subtle text-info` |
| Status block | `border-l-3 border-status-<s>-border bg-status-<s>-bg text-status-<s>-fg` |
| Dialog or sheet scrim | `bg-overlay` |
| Dense text / small print | `text-dense` / `text-2xs` |
| Heading font | `font-heading` |
| Registration | `plate-chip` |
| Domain tag | `domain-tag domain-tag-ownership` |

### 17.3 Component recipes (changes to vendored and shared components)

These are the only edits the theme needs in existing components; they keep the component APIs. Rows marked *new* add a shadcn primitive when the feature that needs it is built.

| File | Change |
|---|---|
| `components/ui/button.tsx` | **Sizes**: `default` → `h-10 px-4 pointer-coarse:h-11`; `sm` → `h-9 px-3 pointer-coarse:h-11`, dropping `text-[0.8rem]` (buttons are `text-sm`); `lg` → `h-11 px-5`; `xs` → `h-6 pointer-coarse:h-11` (copy buttons only); `icon` → `size-10 pointer-coarse:size-11`; `icon-sm` → `size-9 pointer-coarse:size-11`; `icon-lg` → `size-11`; `icon-xs` → `size-6 pointer-coarse:size-11`. Keep each size's gap and icon-size classes. Drop the `rounded-[min(var(--radius-md),…)]` clamps from `sm` and `icon-sm` (with the 4 px `radius-md` they shrank compact buttons below the 6 px control radius); `xs` and `icon-xs` use `rounded-md`. **Base**: `text-sm font-semibold` (was `font-medium`). **Variants**: add `accent` and `signal` (11.2); `outline` → `border-input` in both themes (was `border-border`, 1.3:1); `destructive` → `bg-destructive/10 text-destructive hover:bg-destructive/15`, removing `dark:bg-destructive/20 dark:hover:bg-destructive/30` (dark hover 3.7:1) **and** `focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40` (focus border 2.1:1), so the base `focus-visible:border-ring focus-visible:ring-ring/50` applies; `link` → `text-signal font-semibold`. |
| `components/ui/badge.tsx` | base `h-6 px-2` (was `h-5`), icons `[&>svg]:size-3.5!` (was `size-3!`); `outline` variant `border-input` (was `border-border`); `destructive` variant → `bg-destructive-subtle text-destructive`, removing `focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40` so a focusable badge keeps the base `focus-visible:border-ring` |
| `components/ui/tabs.tsx` | `TabsList`: `group-data-horizontal/tabs:h-10` (was `h-8`). `TabsTrigger`: inactive `text-muted-foreground` in both themes (replaces `text-foreground/60` and `dark:text-muted-foreground`; 3.8:1 before); hover `hover:not-data-active:text-foreground`, replacing `hover:text-foreground` **and** `dark:hover:text-foreground` (the `dark:` one outranks the active segment's text and would put `#f1f1f3` on the signal fill); replace `data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground` with `data-active:text-foreground group-data-[variant=default]/tabs-list:data-active:bg-signal group-data-[variant=default]/tabs-list:data-active:text-signal-foreground`, and the default list's `data-active:shadow-sm` with `shadow-xs` (the signal segmented toggle, 11.5); line indicator `after:bg-signal after:h-[3px] after:rounded-full` (was `after:bg-foreground after:h-0.5`) |
| `components/ui/input.tsx`, `select.tsx` (trigger), `textarea.tsx` | height `h-10 pointer-coarse:h-11` (textarea: `min-h-20`); remove `dark:aria-invalid:border-destructive/50`, so an invalid field keeps the solid `border-destructive` in dark (2.6:1 before, 6.4:1 after) |
| `components/ui/card.tsx` | `CardTitle` → `font-heading text-lg font-semibold` |
| `components/ui/sidebar.tsx` | `SidebarMenuButton`: `data-active:font-semibold data-active:shadow-[inset_3px_0_0_var(--signal)]` (replaces `data-active:font-medium`); default size `h-10 pointer-coarse:h-11` |
| `components/ui/toast.tsx` | `ToastTitle` `text-sm font-semibold` (was `font-medium`); `ToastIcon`: error `CircleXIcon` in `text-destructive` (replaces `OctagonXIcon`), success `CircleCheckIcon` in `text-success`, warning `TriangleAlertIcon` in `text-warning`, info `InfoIcon` in `text-info`; `ToastAction` default render `<Button variant="accent" size="sm" />` (was `outline`) |
| `components/ui/sheet.tsx` | overlay `bg-overlay` (was `bg-black/10`); `SheetContent` adds `data-[side=bottom]:rounded-t-2xl data-[side=bottom]:max-h-[85dvh]`; right and left sides `sm:max-w-md` (was `sm:max-w-sm`) |
| `components/ui/dialog.tsx` | overlay `bg-overlay` (was `bg-black/10`) |
| `components/ui/dropdown-menu.tsx` | destructive item's focus fill `bg-destructive/10` in both themes, removing `dark:...focus:bg-destructive/20` (unaudited; `destructive/10 on popover` is 5.53:1 light, 5.43:1 dark). Menu items in touch layouts take `pointer-coarse:min-h-11` where they are used. Adds `DropdownMenuLinkItem` (Base UI `Menu.LinkItem` with the item's classes, `cursor-pointer`) for the user menu's links (11.20) |
| `components/initials-avatar.tsx` | adds the `lg` size (`size-12 text-base`) for the account card |
| `components/ui/calendar.tsx` | `--cell-radius: var(--radius-md)`; today `ring-1 ring-signal`; day cells 44 px on `pointer-coarse` |
| `components/ui/switch.tsx` (*new*) | track `data-checked:bg-signal data-unchecked:bg-input`; thumb `bg-background` in both themes (removing any `dark:` thumb overrides); a 44 px label row on touch |
| `components/ui/checkbox.tsx` (*new*) | boundary `border-input`; checked `data-checked:bg-primary data-checked:text-primary-foreground data-checked:border-primary`; a 44 px label row on touch |
| `components/problem-alert.tsx` | icon `CircleX` (was `CircleAlert`): a failure uses the traffic-light cross (section 9) |
| `components/app-sidebar.tsx` | the provenance line in `SidebarFooter` (11.1) |

`ScrollArea`'s `focus-visible:outline-1` needs no edit: it takes the solid ring from the base layer.

### 17.4 Adding a token

1. Define it in **both** `.light, :root` and `.dark` in `src/index.css` (`.light` and `.dark` also scope a theme to one element, as the Appearance page's previews do) as an `oklch()` value with a `/* #hex source */` comment after the semicolon (no braces inside comments: `theme-tokens.test.ts` parses these blocks with a regular expression). Colours are opaque; only ink and scrim tokens (`--shadow-ink`, `--overlay`) carry alpha, and `--card` and the status tokens must stay opaque (the test reads them).
2. Expose it in `@theme inline` (`--color-<name>: var(--<name>);` for colours, `--radius-<name>`, `--shadow-<name>`, `--text-<name>` and so on). The utility (`bg-<name>`) exists from then on.
3. Add every text or boundary pair it takes part in to `src/theme-tokens.test.ts` (the test already has `block()` and `contrast()`; add a table of `[foreground, background, minimum]` rows and assert them for both themes), and to section 4.4 of this document.
4. Name it for its role, not its colour (`--signal`, not `--blue`), and document it in section 4.

### 17.5 Review checklist

- [ ] The two `rg` checks in 17.2 print nothing.
- [ ] `pnpm test` passes, including the theme token test; `grep -c "data:font" dist/assets/*.css` prints 0.
- [ ] The attribution notices (the README's licence section) list Plus Jakarta Sans, IBM Plex Sans and IBM Plex Mono, and no longer list Inter.
- [ ] Light and dark screenshots at 375, 390, 768, 1024 and 1440 px: no horizontal page scroll, no clipped text, targets 44 px on touch.
- [ ] Keyboard pass: every control reachable, focus always visible and signal blue (including **Cancel appointment** and links), `Esc` closes overlays.
- [ ] Every status shows icon + label; every outcome shows icon + word; every problem shows its trace id; every empty or error view has one clear action.
- [ ] The sidebar footer shows the provenance line; the wordmark is plain text and not a link.
- [ ] Adopted template files carry no gradients, trend badges or colour dots (11.19).

## 18. Changelog

**v1, author draft (2026-10-12).** Palette, tokens, type, shape, elevation, components, illustrations and the 4.4 audit as first written; `keyloop-theme.css` with five blocks.

**v2, verification fixes (2026-10-12).** Three independent verifiers reviewed v1: a contrast audit (420 theme × pair evaluations), a mechanical application of the theme to a throwaway copy of the web project (lint, typecheck, 123 tests, build, browser check), and a brand and completeness review. Every finding was applied at its root unless noted. The contrast audit was then rerun independently over the final values: 155 pairs, 300 evaluations, no failures outside the REPLACED rows.

Theme (`keyloop-theme.css`):

- **Default outline colour** `outline-ring/50` → `outline-ring` (BLOCK 4). At 50 % the ring was 1.9:1 on white, so every outline-based focus that names no colour (links, the skip link, `ScrollArea`) failed 1.4.11; now 3.9:1 light and 5.6:1 or more dark.
- **Light `--muted-foreground`** `#5c6979` → `#596676` (`oklch(0.505 0.03 255)`, same hue and chroma). It was 4.49:1 on `sidebar-accent` (a hovered nav item, the user row). Re-derived over all 14 light pairs the token is in: the minimum is now 4.70:1. The verifier proposed `oklch(0.51 …)` (minimum 4.62:1); the extra step buys margin for anti-aliased 12 px text.
- **Dark `--input`** `#6b7d8b` → `#6f828f` (`oklch(0.595 0.03 240)`). It was 2.97:1 on `accent`. Re-derived over all 22 dark pairs: boundaries are now 3.17:1 or more (also widening the plate chip on the dark tints from 3.01:1 to 3.20:1), and the placeholder on `input/30` stays 4.73:1. The verifier's `oklch(0.59 …)` gave 3.10:1; going lighter than 0.595 starts to cost placeholder contrast.
- **New tokens**: `--overlay` (scrim, replaces the vendored `bg-black/10`, so the strengthened colour check passes with no exceptions), `--text-2xs` (11/16) and `--text-wordmark` (17/24), so no literal type size is needed.
- **Header**: steps I (never inline fonts) and J (third-party notices) added; font versions checked with `pnpm view` (5.3.0 for all three); the block layout re-checked against commit cb8cb32; the gradient comment corrected (carbon text is 7.65:1 or more on OWNERSHIP, 5.0:1 or more on the other domains, measured over the Oklab-interpolated gradients).

Document:

- **Focus**: destructive button recipe removes the red focus overrides (2.1:1) so the signal focus applies; links get an explicit `outline-ring` focus (11.3); invalid fields keep the solid destructive border in dark (2.6:1 before). One focus colour app-wide, rather than the verifier's alternative `focus-visible:border-destructive`, because a focus indicator that changes colour per variant is harder to find.
- **Selected chips and pills**: the muted sub-line and count switch to `text-primary-foreground/80` (11.70:1 / 8.87:1; muted was 3.06:1 / 1.88:1). Slot chips are a Base UI `RadioGroup`, filter pills a `ToggleGroup`.
- **Audit (4.4)**: rebuilt and widened from 112 to 155 pairs: default outline, link focus, destructive focus, invalid fields, muted text on `sidebar-accent`, `primary-foreground/80`, input on `accent`, `secondary` and each status tint, ring on every surface, status markers and the now line on the hour bands, the meter, outcome icons on their tiles, the switch, selection and the hover states. Figures are now 8-bit quantised and truncated, so they reproduce from the hex values.
- **Agenda card (11.13)**: rebuilt from the fields the schedule endpoint returns: VIN and plate added; make and model removed (they come from `GET /appointments/{id}` in the details sheet, never fetched per card). The card names the other resource (technician in bay mode, bay in technician mode) and the lane header names the grouped one, so every card shows both. The lane name is not repeated on each card (the verifier's sketch repeated it), because inside a lane group it would be the same word on every card.
- **Provenance in the app (11.1)**: a visible sidebar-footer line, and the wordmark is a plain `span`, never a link. Not adopted: `aria-label="Keyloop (demo)"` on the wordmark span, because ARIA 1.2 does not allow naming a generic `span`, so screen readers may ignore it; the visible line reaches everyone, screenshots included.
- **Traffic light (9, 11.17)**: specified as check, triangle and cross with words and tiles, plus 429 and any other code. `CircleX` is now the failure icon everywhere (`ProblemAlert`, error toasts; the stress panel it was first drawn for was removed on 2026-10-12), so an icon means one thing across the app; `CircleAlert` is kept for field errors.
- **Problems (11.16)**: 404, 429 (with `Retry-After`) and any other 4xx added.
- **Colour checks (17.2)**: both commands scan `.ts` too and catch `white`/`black` and `var(--kl-*)`/`var(--domain-*)`; tested against fixtures (a `.ts` status map with `bg-blue-500 text-white` and `#ff0000` is now caught) and against the current source (only the two scrims, which the recipes fix).
- **Template adoption (11.19)**: rules for `section-cards`, `calendars`, the date picker, the calendar list view, the booking form, the optional chart, and the 404 and error-boundary routes (added to 12.1).
- **Fonts (17.1)**: Vite `assetsInlineLimit` step. The verifier's suggested `(file) => !/\.woff2?$/.test(file)` returns `true` for every other file, which would inline every image, the 82–151 KB illustrations included; the step uses `false`/`undefined` instead. The font attribution replacement text is written out.
- **Buttons (11.2, 17.3)**: every size, `xs` and `icon-xs` included, grows to 44 px on touch; the `sm` size's `text-[0.8rem]` and radius clamps removed.
- **Brand fidelity**: the lane toggle is Service Hub's signal-blue segmented control (11.5); the carbon app bar is considered and declined (11.1); the fusion-purple link correction is explained (3.4); the deliberate departures from Addendum B §B4 hues (4.3) and from keyloop.com's type scale and circle-arrow icon (5.2) are stated.
- **Header band (12.3)**: re-measured over every pixel the header covers at widths from 320 px: light band navy 8.52:1, muted 3.59:1, ring 2.42:1; dark band `#f1f1f3` 7.05:1, ring 3.04:1. v1's 8.6:1, 7.1:1 and 2.5:1 were slightly high. The brand verifier's 6.98:1 and this revision's 7.05:1 for the same pixel differ only by WebP decoder (sips against ffmpeg); the doc now states the floor every decoder clears (6.9:1) and labels the second decimal as noise. The images README's 7.88:1 is for white `#ffffff`, not the theme's `#f1f1f3`. The offset-ring rule now also gives the focused button a background fill, because a ring offset only shields the ring's outer side.
- **Illustrations (12)**: file names, sizes and alt text aligned with the images README and written into 12.4, because the README itself is not copied into the web project.
- **Found while finalizing** (compiled with the project's Tailwind 4.3.3 and checked against its `cn` merge): shadcn's `data-checked` and `data-active` variants (defined in `shadcn/tailwind.css`) compile to zero-specificity `:where()` selectors, so a plain `hover:` class outranks them. The v1 slot chip (`hover:bg-accent`) would have turned a hovered selected chip pale under white text (1.15:1), and the shipped `dark:hover:text-foreground` on tabs would have put `#f1f1f3` on the signal segment (2.32:1). The recipes now use `hover:not-data-checked:` and `hover:not-data-active:`, and remove the dark hover; the filter pills use `hover:not-data-pressed:` too, so no hover can reach a selected state whatever the selector weights. The full-screen booking sheet's overrides now carry the `data-[side=bottom]:` variant, or the bottom-sheet recipe's `max-h-[85dvh]` would cap it.
- **Smaller**: toast title weight and icons, switch and checkbox recipes, bottom-sheet radius and height in `sheet.tsx`, side-sheet width, stepper `aria-current` and focus on step change, badge icon size, status icon tiles named with `role="img"`.

Left open: the illustrations' visual fit is verified only in isolation (on light and dark canvases); check them in the running board during the Task 17b visual QA.

**v3, Appointments list (Task 17c, 2026-10-12).** The appointments table in 11.17 (status bar, compact sort headers, faceted filters with counts, row actions menu, width-dependent columns, the sticky time column on narrow screens, job cards and a filter sheet on phones); the tasks data table and the users stat cards in the 11.19 adoption table; the dropdown menu's destructive focus fill in 17.3; the Cancelled row of 4.3 corrected (the list reads the schedule, which omits cancelled appointments). No new token: the sticky cell's fill mixes existing ones.

**v4, booking intake triage (Task 26, 2026-10-12).** The suggested-service cards in 11.6 (a radio group of cards with the likelihood word, percentage and meter, the day-asked-for chip) and the meter's second use in section 13. No new token: the cards reuse the slot chip's surface, border and focus, and the meter's pair is already in the audit.

**v5, resources, settings and error pages (Task 29, 2026-10-12).** The resource tables and their cards in 11.17; the users app, the settings app's appearance and account pages and the errors app's 401, 403, 500 and 503 pages in the 11.19 adoption table; the new error pages and the icon tile that tells apart pages sharing an illustration in 12.1; the meter's use on the resources pages in 13; the sidebar's three groups in 11.1. `.light` now scopes the light tokens to an element as `.dark` scopes the dark ones (17.4), so the Appearance page draws a light preview inside the dark theme. No new token.

**v6, wave-2 illustrations (FE integration, 2026-10-12).** Each error page gets its own picture (401 `unauthorized`, 403 `forbidden`, 404 `not-found`, 500 and other 5xx `server-error`, 503 `maintenance`), described by its alt text, and the icon tiles that marked the shared `closed-day` picture are removed (12.1). `empty-technicians` for the empty Technicians and Bays lists; `photo-evidence` in the triage photo field before the first photo, the one in-form illustration (`w-20 sm:w-24`). Alt text for the seven in 12.4. No new token.

**v7, sign-in and roles (Task 27b, 2026-10-12).** Section 11.20: the user menu's states, the sign-in prompt (a dialog with `sign-in-to-book.webp`) and the details sheet's sign-in panel, disabled-with-reason (`aria-disabled` plus a visible `WriteReason` named by `aria-describedby`), the session dialog for `401` and `403` (11.16 row), and the development server's *How to sign in*. The user row in 11.1, the account page in 11.19, `sign-in-to-book.webp` in 12.1 and 12.4 (eight wave-2 files in use), `DropdownMenuLinkItem` and the avatar's `lg` size in 17.3. A link styled with `buttonVariants` goes through `cn()`, or an outline variant keeps the base's transparent border. No new token: every pair used (`foreground` and `muted-foreground` on `muted`, `success` on `card`) is already in the audit.
