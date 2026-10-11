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
        restoreMocks: true,
      },
    })
  )
)
