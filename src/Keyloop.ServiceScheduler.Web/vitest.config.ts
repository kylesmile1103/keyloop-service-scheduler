import { defineConfig, mergeConfig } from "vitest/config"

import viteConfig from "./vite.config.ts"

export default defineConfig((env) =>
  mergeConfig(
    viteConfig(env),
    defineConfig({
      test: {
        environment: "jsdom",
        setupFiles: ["./src/test-setup.ts"],
        // Tests import `describe`/`it`/`expect` from "vitest" explicitly; the setup file registers RTL's cleanup.
        globals: false,
        // Above the 3 s a single findBy or waitFor may take (src/test-setup.ts), so a slow wait is not cut off by the test's
        // own limit when several follow each other on a loaded machine. A test that hangs still fails.
        testTimeout: 15_000,
        restoreMocks: true,
        unstubGlobals: true,
        unstubEnvs: true,
        // A browser resolves the client's same-origin paths ("/api/v1/...") against the page; Node's fetch needs an absolute
        // URL, so tests give the generated client jsdom's origin as its base URL (see src/api/runtime.ts).
        // TZ: the browser's own zone must never decide a dealership's day; UTC on every machine makes a test that
        // confused the two fail everywhere, not only where the zones happen to disagree.
        env: { VITE_API_BASE_URL: "http://localhost:3000", TZ: "UTC" },
      },
    })
  )
)
