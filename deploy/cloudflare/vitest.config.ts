import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The real Container class is exercised against a fake runtime, so its workerd import needs a Node stand-in.
  resolve: { alias: { "cloudflare:workers": fileURLToPath(new URL("./test/stubs/cloudflare-workers.ts", import.meta.url)) } },
  test: {
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
    server: { deps: { inline: ["@cloudflare/containers"] } },
  },
});
