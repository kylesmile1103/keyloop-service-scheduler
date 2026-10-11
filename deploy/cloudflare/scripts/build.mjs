import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";

// Local build only. Non-secret identifiers are supplied by the caller.
const taskEnv = {
  ...process.env,
  CF_SEND_TELEMETRY: "false",
  WRANGLER_SEND_METRICS: "false",
  XDG_CONFIG_HOME: new URL("../build/config/", import.meta.url).pathname,
  WRANGLER_LOG_PATH: "./build/wrangler-logs/",
  TMPDIR: new URL("../build/tmp/", import.meta.url).pathname,
};
delete taskEnv.CLOUDFLARE_API_TOKEN;
delete taskEnv.CLOUDFLARE_API_KEY;
delete taskEnv.CLOUDFLARE_ACCOUNT_ID;
await mkdir(taskEnv.TMPDIR, { recursive: true });
const result = spawnSync(new URL("../node_modules/.bin/cf", import.meta.url).pathname, ["build"], {
  cwd: new URL("../", import.meta.url), env: taskEnv, stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
