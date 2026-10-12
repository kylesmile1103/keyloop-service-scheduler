import type { CreateClientConfig } from "./client.gen"

/**
 * Initial configuration of the generated API client (HeyAPI's `runtimeConfigPath`, see openapi-ts.config.ts). This is the one
 * hand-written file in src/api; generation never overwrites it.
 *
 * The API is called on the page's own origin: the Vite dev server proxies `/api` to it, and so does nginx in the container.
 * A build can point the client elsewhere with `VITE_API_BASE_URL` (the API must then allow the page's origin, §11.2).
 *
 * Per-request concerns do not belong here: whatever this returns is shared by every request. The request id and the error
 * annotation are interceptors, registered by src/lib/api-client.ts.
 */
export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseUrl: (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, ""),
})
