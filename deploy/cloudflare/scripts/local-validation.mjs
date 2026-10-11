import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const action = process.argv[2];
if (action !== "types" && action !== "build") throw new Error("Use types or build");
const integrations = process.argv[3] === "--integrations";

// Identifiers and fixture assets only, never credentials. This command cannot deploy.
const taskEnv = {
  ...process.env,
  KEYLOOP_SECRETS_STORE_ID: "00000000000000000000000000000000",
  KEYLOOP_API_IMAGE: "registry.cloudflare.com/00000000000000000000000000000000/keyloop-scheduler-api:local-validation",
  KEYLOOP_NOTIFICATIONS_ENABLED: "false",
  KEYLOOP_EMAIL_SENDING_ENABLED: "false",
  KEYLOOP_EMAIL_TRANSPORT: integrations ? "rest" : "binding",
  KEYLOOP_EMAIL_ACCOUNT_ID: integrations ? "00000000000000000000000000000000" : "",
  KEYLOOP_EMAIL_ALLOWED_ADDRESSES: "",
  KEYLOOP_EMAIL_ALLOWED_DOMAINS: "",
  KEYLOOP_EMAIL_MAX_PER_DAY: "100",
  KEYLOOP_EMAIL_MAX_PER_RECIPIENT_PER_DAY: "10",
  KEYLOOP_OTLP_RELAY_ENABLED: integrations ? "true" : "false",
  KEYLOOP_GRAFANA_OTLP_ENDPOINT: integrations ? "https://otlp-gateway-local.grafana.net/otlp" : "",
  CLOUDFLARE_SEND_METRICS: "false",
  CF_SEND_TELEMETRY: "false",
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_LOG_PATH: "./build/wrangler-logs/",
  XDG_CONFIG_HOME: new URL("../build/config/", import.meta.url).pathname,
  TMPDIR: new URL("../build/tmp/", import.meta.url).pathname,
};
await mkdir(taskEnv.TMPDIR, { recursive: true });
delete taskEnv.CLOUDFLARE_API_TOKEN;
delete taskEnv.CLOUDFLARE_API_KEY;
delete taskEnv.CLOUDFLARE_ACCOUNT_ID;
if (action === "build") {
  // Never overwrite an assembled SPA. A separate fixture is selected via the build config below.
  await mkdir(new URL("../build/validation-assets/", import.meta.url), { recursive: true });
  await writeFile(new URL("../build/validation-assets/index.html", import.meta.url), "<!doctype html><title>Local edge validation fixture</title>");
  await copyFile(new URL("../public/_headers", import.meta.url), new URL("../build/validation-assets/_headers", import.meta.url));
  taskEnv.KEYLOOP_VALIDATE_ASSETS = "true";
}
const args = action === "types" ? ["workers", "types"] : ["build"];
const result = spawnSync(new URL("../node_modules/.bin/cf", import.meta.url).pathname, args, {
  cwd: new URL("../", import.meta.url), env: taskEnv, stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
if (action === "build" && result.status === 0) {
  const output = new URL("../.cloudflare/output/v0/", import.meta.url);
  const worker = JSON.parse(await readFile(new URL("workers/default/worker.config.json", output), "utf8"));
  const container = JSON.parse(await readFile(new URL("containers/keyloop-scheduler-api/container.config.json", output), "utf8"));
  assert.deepEqual(worker.assets, { notFoundHandling: "single-page-application", runWorkerFirst: ["/api", "/api/*", "/otlp", "/otlp/*"] });
  assert.deepEqual(worker.domains, ["keyloop.kylesmile.me"]);
  assert.equal(worker.workersDev, false);
  assert.equal(worker.previewUrls, false);
  assert.deepEqual(worker.env.EMAIL.allowedSenderAddresses, ["notifications@keyloop.kylesmile.me"]);
  assert.equal(worker.env.DB_URL.secretName, "keyloop_prod_db_url");
  assert.equal(worker.env.EMAIL_SENDING_ENABLED.value, "false");
  assert.equal(worker.env.OTLP_RELAY_LIMITER.type, "rate-limit");
  assert.equal(worker.exports.ApiContainer.container, "keyloop-scheduler-api");
  assert.equal(container.schedulingPolicy, "default");
  assert.equal(container.instanceType, "basic");
  assert.equal(container.maxInstances, 1);
  assert.deepEqual(container.constraints.regions, ["WEUR"]);
  assert.equal(Boolean(worker.env.EMAIL_API_TOKEN), integrations);
  assert.equal(Boolean(worker.env.GRAFANA_OTLP_BASIC_BROWSER), integrations);
  if (integrations) {
    assert.equal(worker.env.EMAIL_API_TOKEN.secretName, "keyloop_prod_email_api_token");
    assert.equal(worker.env.GRAFANA_OTLP_BASIC_BROWSER.secretName, "grafana-otlp-basic-browser");
  }
  console.log(`Local build metadata verified (${integrations ? "REST email and OTLP" : "integrations disabled"})`);
}
