// Adopted from shadcn-dashboard-landing-template (vite-version) `vite.config.ts`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type ProxyOptions } from "vite"

type Env = Record<string, string | undefined>

/**
 * Where the dev server forwards `/api`, `/openapi` and `/scalar`. Under Aspire the `web` resource references the API, which
 * injects `API_HTTP` (and the older `services__api__http__0` form); a standalone run falls back to the API's `http` launch
 * profile. The HTTP endpoint keeps the proxy clear of dev-certificate trust problems.
 */
export function apiProxyTarget(env: Env = process.env): string {
  return env.API_HTTP || env.services__api__http__0 || "http://localhost:5180"
}

/** Aspire owns the port when it sets `PORT`; then a busy port must fail loudly instead of silently moving. */
export function devServerPort(env: Env = process.env): { port: number; strictPort: boolean } {
  const port = Number(env.PORT)
  return Number.isInteger(port) && port > 0 ? { port, strictPort: true } : { port: 5173, strictPort: false }
}

/**
 * Browser telemetry settings, compiled into the bundle as `import.meta.env.VITE_OTEL_*`.
 *
 * Security: the OTLP headers carry the Aspire dashboard's API key, so they reach the browser ONLY from the development
 * dev server (`vite` in development mode, where Aspire injects `OTEL_*`). Every other build (production, a development-mode
 * `vite build`, tests) compiles them empty, so telemetry is off unless `VITE_OTEL_EXPORTER_OTLP_ENDPOINT` names a
 * secret-free collector explicitly at build time.
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

/**
 * Vite's `build.assetsInlineLimit`: never inline a font. Vite inlines assets under 4 KB as `data:` URIs, and one Plus
 * Jakarta Sans subset is that small, but the production CSP (nginx/security-headers.conf, `font-src 'self'`) blocks a
 * `data:` font. `undefined` keeps Vite's 4 KB rule for everything else (`true` would inline every illustration too).
 */
export function inlineAsset(file: string): boolean | undefined {
  return /\.woff2?$/.test(file) ? false : undefined
}

function apiProxy(target: string): Record<string, ProxyOptions> {
  return Object.fromEntries(["/api", "/openapi", "/scalar"].map((prefix) => [prefix, { target, changeOrigin: true }]))
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const proxy = apiProxy(apiProxyTarget())

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
    define: otelDefines(command, mode),
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
