/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Browser OTLP settings; vite.config.ts compiles them in (development dev server only, see otelDefines). */
  readonly VITE_OTEL_EXPORTER_OTLP_ENDPOINT?: string
  readonly VITE_OTEL_EXPORTER_OTLP_HEADERS?: string
  readonly VITE_OTEL_RESOURCE_ATTRIBUTES?: string
  readonly VITE_OTEL_SERVICE_NAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
