# Reference material (provenance)

The UI harness borrows layout conventions and vendored shadcn/ui components from the MIT-licensed
**shadcn-dashboard-landing-template** (Vite variant), copied into `src/Keyloop.ServiceScheduler.Web`
following the shadcn "own your components" model.

| Reference | Upstream | License | Used for |
|-----------|----------|---------|----------|
| shadcn-dashboard-landing-template (vite-version) | https://github.com/shadcnstore/shadcn-dashboard-landing-template | MIT | App shell (sidebar, header, theme provider), `components/ui/*`, Tailwind v4 theme tokens, ESLint/TS config |
| carcareco | https://github.com/rene98c/carcareco | see upstream | Domain inspiration only (vehicle/work-order shape); no code copied |
| MiroTalk WEB (booking module) | https://github.com/miroslavpejic85/mirotalkwebrtc | AGPL-3.0 | Design inspiration only (availability model, DST handling, re-check-then-insert); **no code copied** because of the AGPL licence |

The clones themselves are intentionally **not** committed (see `.gitignore`); they live one level above this repository on the author's machine.
