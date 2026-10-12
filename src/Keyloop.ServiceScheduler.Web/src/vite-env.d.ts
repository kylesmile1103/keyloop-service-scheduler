// Adopted from shadcn-dashboard-landing-template (vite-version) `src/vite-env.d.ts`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the API when it is not the page's own (src/api/runtime.ts); unset, the client calls same-origin `/api/...`. */
  readonly VITE_API_BASE_URL?: string
  /** Browser OTLP settings; vite.config.ts compiles them in (development dev server only, see otelDefines). */
  readonly VITE_OTEL_EXPORTER_OTLP_ENDPOINT?: string
  readonly VITE_OTEL_EXPORTER_OTLP_HEADERS?: string
  readonly VITE_OTEL_RESOURCE_ATTRIBUTES?: string
  readonly VITE_OTEL_SERVICE_NAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
