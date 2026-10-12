import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";

const temporaryDirectory = new URL("../build/tmp/", import.meta.url);
await mkdir(temporaryDirectory, { recursive: true });
const result = spawnSync(new URL("../node_modules/.bin/vitest", import.meta.url).pathname, ["run", ...process.argv.slice(2)], {
  cwd: new URL("../", import.meta.url),
  env: { ...process.env, TMPDIR: temporaryDirectory.pathname, CF_SEND_TELEMETRY: "false", CLOUDFLARE_SEND_METRICS: "false", WRANGLER_SEND_METRICS: "false" },
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
