import { defineConfig, mergeConfig } from "vitest/config"

import viteConfig from "./vite.config.ts"

export default defineConfig((env) =>
  mergeConfig(
    viteConfig(env),
    defineConfig({
      test: {
        environment: "jsdom",
        setupFiles: ["./src/test-setup.ts"],
        globals: false,
        testTimeout: 15_000,
        restoreMocks: true,
        unstubGlobals: true,
        unstubEnvs: true,
        // Node fetch requires an absolute base URL; UTC ensures tests do not depend on the host timezone.
        env: { VITE_API_BASE_URL: "http://localhost:3000", TZ: "UTC" },
      },
    })
  )
)
