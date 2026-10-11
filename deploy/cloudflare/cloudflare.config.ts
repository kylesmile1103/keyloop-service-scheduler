import { bindings, defineConfig, defineContainer, exports } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

function requiredIdentifier(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} before evaluating the edge configuration`);
  return value;
}

const storeId = requiredIdentifier("KEYLOOP_SECRETS_STORE_ID");
const emailTransport = process.env.KEYLOOP_EMAIL_TRANSPORT ?? "binding";
const otlpEnabled = process.env.KEYLOOP_OTLP_RELAY_ENABLED === "true";
const api = defineContainer({
  name: "keyloop-scheduler-api",
  image: { reference: requiredIdentifier("KEYLOOP_API_IMAGE") },
  schedulingPolicy: "default",
  instanceType: "basic",
  maxInstances: 1,
  constraints: { regions: ["WEUR"] },
});

export default defineConfig({
  worker: {
    name: "keyloop-scheduler",
    entrypoint,
    compatibilityDate: "2026-10-12",
    compatibilityFlags: ["nodejs_compat"],
    domains: ["keyloop.kylesmile.me"],
    workersDev: false,
    previewUrls: false,
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api", "/api/*", "/otlp", "/otlp/*"],
    },
    observability: {
      enabled: true,
      headSamplingRate: 1,
      redactQueryString: true,
      logs: { enabled: true, invocationLogs: true },
      traces: { enabled: true, headSamplingRate: 1 },
    },
    exports: { ApiContainer: exports.durableObject({ storage: "sqlite", container: api }) },
    env: {
      ASSETS: bindings.assets(),
      API: bindings.durableObject({ worker: "keyloop-scheduler", exportName: "ApiContainer" }),
      DB_URL: bindings.secretsStoreSecret({ storeId, secretName: "keyloop_prod_db_url" }),
      EMAIL: bindings.sendEmail({ allowedSenderAddresses: ["notifications@keyloop.kylesmile.me"] }),
      // Disabled integrations must not require provisioning unused credentials.
      ...(emailTransport === "rest" ? {
        EMAIL_API_TOKEN: bindings.secretsStoreSecret({ storeId, secretName: "keyloop_prod_email_api_token" }),
      } : {}),
      ...(otlpEnabled ? {
        GRAFANA_OTLP_BASIC_BROWSER: bindings.secretsStoreSecret({ storeId, secretName: "grafana-otlp-basic-browser" }),
      } : {}),
      NOTIFY_FROM: bindings.text("notifications@keyloop.kylesmile.me"),
      NOTIFY_FROM_NAME: bindings.text("Keyloop Service Scheduler (demo)"),
      NOTIFICATIONS_ENABLED: bindings.text(process.env.KEYLOOP_NOTIFICATIONS_ENABLED ?? "false"),
      EMAIL_SENDING_ENABLED: bindings.text(process.env.KEYLOOP_EMAIL_SENDING_ENABLED ?? "false"),
      EMAIL_TRANSPORT: bindings.text(emailTransport),
      EMAIL_ACCOUNT_ID: bindings.text(process.env.KEYLOOP_EMAIL_ACCOUNT_ID ?? ""),
      EMAIL_ALLOWED_ADDRESSES: bindings.text(process.env.KEYLOOP_EMAIL_ALLOWED_ADDRESSES ?? ""),
      EMAIL_ALLOWED_DOMAINS: bindings.text(process.env.KEYLOOP_EMAIL_ALLOWED_DOMAINS ?? ""),
      EMAIL_MAX_PER_RECIPIENT_PER_DAY: bindings.text(process.env.KEYLOOP_EMAIL_MAX_PER_RECIPIENT_PER_DAY ?? "10"),
      EMAIL_MAX_PER_DAY: bindings.text(process.env.KEYLOOP_EMAIL_MAX_PER_DAY ?? "100"),
      OTLP_RELAY_ENABLED: bindings.text(process.env.KEYLOOP_OTLP_RELAY_ENABLED ?? "false"),
      GRAFANA_OTLP_ENDPOINT: bindings.text(process.env.KEYLOOP_GRAFANA_OTLP_ENDPOINT ?? ""),
      OTLP_RELAY_LIMITER: bindings.rateLimit({ namespace: "2001", simple: { limit: 120, period: 60 } }),
    },
  },
  containers: [api],
});
