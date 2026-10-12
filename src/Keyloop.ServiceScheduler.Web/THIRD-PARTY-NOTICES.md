# Third-party notices

The dispatch board's application shell and UI primitives are derived from the projects below. npm dependencies carry
their own licence files in `node_modules/<package>`; the notices here cover source code and assets copied into this
project or shipped in its build output.

## shadcn-dashboard-landing-template (Vite version)

Source: https://github.com/shadcnstore/shadcn-dashboard-landing-template - used for the project layout and
configuration (Vite, TypeScript, ESLint, `components.json`), the app shell (`components/app-sidebar.tsx`,
`site-header.tsx`, `nav-main.tsx`, `nav-user.tsx`, `mode-toggle.tsx`, `theme-provider.tsx`, `layouts/base-layout.tsx`,
`router/root-layout.tsx`, `hooks/*`), the vendored `components/ui/*` primitives and the Tailwind v4 theme tokens in
`src/index.css`. Files have been modified for this project. The template's own logos, landing pages, demo apps and
analytics are not included.

Adopted from the template's apps (`vite-version/src/app/`) and adapted to the generated API client, with their sample
data removed: `dashboard/components/section-cards.tsx` (and `dashboard-2/components/metrics-overview.tsx`) as the dispatch
board's KPI strip (`app/dispatch/components/kpi-strip.tsx`); `calendar/components/date-picker.tsx` as the board's date
control (`date-navigator.tsx`); `calendar/components/calendars.tsx` and `calendar-sidebar.tsx` as the lane filter
(`lane-filter.tsx`); the list view of `calendar/components/calendar-main.tsx` as the phone agenda (`schedule-agenda.tsx`);
and the mobile sheet of `calendar/components/calendar.tsx` as the board's Filters sheet (`filters-sheet.tsx`);
`calendar/components/event-form.tsx` and `users/components/user-form-dialog.tsx` as the booking dialog
(`booking-dialog.tsx`); `dashboard/components/section-cards.tsx` again as the stress panel's tally tiles
(`stress-panel.tsx`); the tasks app's data table (`tasks/components/data-table.tsx`, `columns.tsx`,
`data-table-column-header.tsx`, `data-table-faceted-filter.tsx`, `data-table-pagination.tsx`,
`data-table-row-actions.tsx`, `data-table-toolbar.tsx`, `data-table-view-options.tsx` and `lib/data-table.ts`) as the
Appointments list (`app/appointments/components/*`, `lib/data-table.ts`), and `users/components/stat-cards.tsx` as its
day figures (`stat-cards.tsx`). The
`components/ui/switch.tsx`, `checkbox.tsx` and `collapsible.tsx` primitives are vendored unmodified, and
`components/ui/table.tsx` with the design system's table header and row heights.

```
MIT License

Copyright (c) 2025 ShadcnStore

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## shadcn/ui

Source: https://github.com/shadcn-ui/ui - the `components/ui/*` primitives in the template above originate from
shadcn/ui (Base UI variant). MIT License, Copyright (c) 2023 shadcn. The licence text is identical to the one above.

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
