import { bindings, defineConfig, defineContainer, exports } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };
import { edgeSettings } from "./src/settings.ts";

// Throws on an invalid setting, so `cf build` fails rather than the first cold start, send or trace export.
const settings = edgeSettings(process.env);
const storeId = settings.secretsStoreId;
const api = defineContainer({
  name: "keyloop-scheduler-api",
  image: { reference: settings.apiImage },
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
      ...(settings.triageEnabled === "true" ? {
        AI_TOKEN: bindings.secretsStoreSecret({ storeId, secretName: "keyloop_prod_ai_token" }),
      } : {}),
      TRIAGE_ENABLED: bindings.text(settings.triageEnabled),
      TRIAGE_ACCOUNT_ID: bindings.text(settings.triageAccountId),
      TRIAGE_GATEWAY_ID: bindings.text(settings.triageGatewayId),
      EMAIL: bindings.sendEmail({ allowedSenderAddresses: ["notifications@keyloop.kylesmile.me"] }),
      // Disabled integrations must not require provisioning unused credentials.
      ...(settings.emailTransport === "rest" ? {
        EMAIL_API_TOKEN: bindings.secretsStoreSecret({ storeId, secretName: "keyloop_prod_email_api_token" }),
      } : {}),
      ...(settings.otlpRelayEnabled === "true" ? {
        GRAFANA_OTLP_BASIC_BROWSER: bindings.secretsStoreSecret({ storeId, secretName: "grafana-otlp-basic-browser" }),
      } : {}),
      NOTIFY_FROM: bindings.text("notifications@keyloop.kylesmile.me"),
      NOTIFY_FROM_NAME: bindings.text("Keyloop Service Scheduler (demo)"),
      NOTIFICATIONS_ENABLED: bindings.text(settings.notificationsEnabled),
      EMAIL_SENDING_ENABLED: bindings.text(settings.emailSendingEnabled),
      EMAIL_TRANSPORT: bindings.text(settings.emailTransport),
      EMAIL_ACCOUNT_ID: bindings.text(settings.emailAccountId),
      EMAIL_ALLOWED_ADDRESSES: bindings.text(settings.emailAllowedAddresses),
      EMAIL_ALLOWED_DOMAINS: bindings.text(settings.emailAllowedDomains),
      EMAIL_MAX_PER_RECIPIENT_PER_DAY: bindings.text(settings.emailMaxPerRecipientPerDay),
      EMAIL_MAX_PER_DAY: bindings.text(settings.emailMaxPerDay),
      OTLP_RELAY_ENABLED: bindings.text(settings.otlpRelayEnabled),
      GRAFANA_OTLP_ENDPOINT: bindings.text(settings.grafanaOtlpEndpoint),
      OTLP_RELAY_LIMITER: bindings.rateLimit({ namespace: "2001", simple: { limit: 120, period: 60 } }),
    },
  },
  containers: [api],
});
