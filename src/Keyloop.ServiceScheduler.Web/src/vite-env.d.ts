// Adopted from shadcn-dashboard-landing-template (vite-version) `src/vite-env.d.ts`,
// Copyright (c) 2025 ShadcnStore, MIT License.

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin when different from the page origin; defaults to same-origin `/api/...`. */
  readonly VITE_API_BASE_URL?: string
  /** Browser OTLP settings compiled by vite.config.ts. */
  readonly VITE_OTEL_EXPORTER_OTLP_ENDPOINT?: string
  readonly VITE_OTEL_EXPORTER_OTLP_HEADERS?: string
  readonly VITE_OTEL_RESOURCE_ATTRIBUTES?: string
  readonly VITE_OTEL_SERVICE_NAME?: string
  /** Identity source compiled by vite.config.ts. */
  readonly VITE_IDENTITY_SOURCE?: "access" | "configuration"
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
