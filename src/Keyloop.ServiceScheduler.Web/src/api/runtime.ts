import type { CreateClientConfig } from "./client.gen"

/**
 * Runtime configuration for the generated API client (`runtimeConfigPath` in openapi-ts.config.ts).
 * Defaults to same-origin requests unless `VITE_API_BASE_URL` is configured.
 */
export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseUrl: (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, ""),
})
