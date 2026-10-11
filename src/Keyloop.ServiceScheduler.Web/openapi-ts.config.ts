import { defineConfig } from "@hey-api/openapi-ts"

/**
 * Generates the typed API client from the committed contract (`dotnet build` of the API writes it; never edit it by hand).
 * Option names are those of @hey-api/openapi-ts 0.99.
 */
export default defineConfig({
  input: "../../contracts/openapi/v1.json",
  output: {
    path: "src/api",
    // The default (`clean: true`) deletes the whole folder before writing, which would take the hand-written
    // `src/api/runtime.ts` with it. Every generated file is rewritten on each run, so nothing stale survives a regeneration
    // unless a plugin below is removed; then delete its output by hand.
    clean: false,
  },
  plugins: [
    "@hey-api/typescript",
    "@hey-api/sdk",
    // runtime.ts's `createClientConfig()` supplies the base URL. Per-request behaviour (the X-Request-Id, keeping the status
    // of a failure without a problem body) is registered on the generated client by src/lib/api-client.ts.
    { name: "@hey-api/client-fetch", runtimeConfigPath: "./src/api/runtime.ts" },
    { name: "@tanstack/react-query", queryOptions: true, mutationOptions: true, queryKeys: true },
  ],
})
