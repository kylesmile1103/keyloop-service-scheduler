// Adopted from shadcn-dashboard-landing-template (vite-version) `vite.config.ts`,
// Copyright (c) 2025 ShadcnStore, MIT License.
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type ProxyOptions } from "vite"

type Env = Record<string, string | undefined>

/** Resolves the backend target URL for dev-server API proxying (Aspire env vars or local HTTP fallback). */
export function apiProxyTarget(env: Env = process.env): string {
  return env.API_HTTP || env.services__api__http__0 || "http://localhost:5180"
}

/** Uses Aspire's `PORT` with `strictPort: true` when set, or falls back to 5173. */
export function devServerPort(env: Env = process.env): { port: number; strictPort: boolean } {
  const port = Number(env.PORT)
  return Number.isInteger(port) && port > 0 ? { port, strictPort: true } : { port: 5173, strictPort: false }
}

/**
 * Compiles `import.meta.env.VITE_OTEL_*` browser telemetry settings.
 * OTLP headers (containing the Aspire dashboard key) are only exposed to the development dev server.
 */
export function otelDefines(command: "serve" | "build", mode: string, env: Env = process.env): Record<string, string> {
  const development = command === "serve" && mode === "development"
  const values = development
    ? {
        VITE_OTEL_EXPORTER_OTLP_ENDPOINT: env.OTEL_EXPORTER_OTLP_ENDPOINT,
        VITE_OTEL_EXPORTER_OTLP_HEADERS: env.OTEL_EXPORTER_OTLP_HEADERS,
        VITE_OTEL_RESOURCE_ATTRIBUTES: env.OTEL_RESOURCE_ATTRIBUTES,
        VITE_OTEL_SERVICE_NAME: env.OTEL_SERVICE_NAME,
      }
    : {
        VITE_OTEL_EXPORTER_OTLP_ENDPOINT: mode === "production" ? env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT : undefined,
        VITE_OTEL_EXPORTER_OTLP_HEADERS: undefined,
        VITE_OTEL_RESOURCE_ATTRIBUTES: mode === "production" ? env.VITE_OTEL_RESOURCE_ATTRIBUTES : undefined,
        VITE_OTEL_SERVICE_NAME: mode === "production" ? env.VITE_OTEL_SERVICE_NAME : undefined,
      }

  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value ?? "")])
  )
}

/** Compiles `import.meta.env.VITE_IDENTITY_SOURCE` (`"configuration"` in dev server, `"access"` otherwise). */
export function identityDefines(command: "serve" | "build", mode: string): Record<string, string> {
  const source = command === "serve" && mode === "development" ? "configuration" : "access"
  return { "import.meta.env.VITE_IDENTITY_SOURCE": JSON.stringify(source) }
}

/** Prevents inlining `.woff`/`.woff2` fonts as `data:` URIs (blocked by production `font-src 'self'` CSP). */
export function inlineAsset(file: string): boolean | undefined {
  return /\.woff2?$/.test(file) ? false : undefined
}

function apiProxy(target: string): Record<string, ProxyOptions> {
  return Object.fromEntries(["/api", "/auth", "/openapi", "/scalar"].map((prefix) => [prefix, { target, changeOrigin: true }]))
}

export default defineConfig(({ command, mode }) => {
  const proxy = apiProxy(apiProxyTarget())

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
    define: { ...otelDefines(command, mode), ...identityDefines(command, mode) },
    build: { assetsInlineLimit: inlineAsset },
    server: {
      host: true,
      ...devServerPort(),
      proxy,
    },
    preview: {
      proxy,
    },
  }
})
