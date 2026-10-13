import { defineConfig } from "@hey-api/openapi-ts"

/** Generates the typed API client from the OpenAPI contract. */
export default defineConfig({
  input: "../../contracts/openapi/v1.json",
  output: {
    path: "src/api",
    // Keep clean: false so generation does not delete hand-written src/api/runtime.ts.
    clean: false,
  },
  plugins: [
    "@hey-api/typescript",
    "@hey-api/sdk",
    { name: "@hey-api/client-fetch", runtimeConfigPath: "./src/api/runtime.ts" },
    { name: "@tanstack/react-query", queryOptions: true, mutationOptions: true, queryKeys: true },
  ],
})
