import { emailCaps, recipientAllowlist, triageSettings } from "./container-env.ts";
import { grafanaTracesUrl } from "./otlp.ts";

// cloudflare.config.ts evaluates this, so a misconfigured deployment fails `cf build` instead of the first cold start,
// send or trace export. The Worker and the container start keep their own checks. An empty value means unset.
type Source = Readonly<Record<string, string | undefined>>;

function setting(source: Source, name: string, fallback: string): string {
  const value = source[name];
  return value === undefined || value === "" ? fallback : value;
}

function required(source: Source, name: string): string {
  const value = source[name]?.trim();
  if (!value) throw new Error(`Set ${name} before evaluating the edge configuration`);
  return value;
}

function flag(source: Source, name: string): "true" | "false" {
  const value = setting(source, name, "false");
  if (value !== "true" && value !== "false") throw new Error(`Set ${name} to true or false`);
  return value;
}

export function edgeSettings(source: Source) {
  const secretsStoreId = required(source, "KEYLOOP_SECRETS_STORE_ID");
  const apiImage = required(source, "KEYLOOP_API_IMAGE");
  const notificationsEnabled = flag(source, "KEYLOOP_NOTIFICATIONS_ENABLED");
  const emailSendingEnabled = flag(source, "KEYLOOP_EMAIL_SENDING_ENABLED");
  const otlpRelayEnabled = flag(source, "KEYLOOP_OTLP_RELAY_ENABLED");
  const triageEnabled = flag(source, "KEYLOOP_TRIAGE_ENABLED");
  const triageAccountId = setting(source, "KEYLOOP_TRIAGE_ACCOUNT_ID", "");
  const triageGatewayId = setting(source, "KEYLOOP_TRIAGE_GATEWAY_ID", "keyloop-scheduler");
  const triageBucket = setting(source, "KEYLOOP_TRIAGE_BUCKET", "keyloop-scheduler-triage");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(triageBucket)) throw new Error("Configure a valid triage R2 bucket name");
  triageSettings(triageEnabled, triageAccountId, triageGatewayId);
  const emailTransport = setting(source, "KEYLOOP_EMAIL_TRANSPORT", "binding");
  if (emailTransport !== "binding" && emailTransport !== "rest") throw new Error("Set KEYLOOP_EMAIL_TRANSPORT to binding or rest");
  const emailAccountId = setting(source, "KEYLOOP_EMAIL_ACCOUNT_ID", "");
  if (emailTransport === "rest" && !/^[a-f0-9]{32}$/i.test(emailAccountId)) {
    throw new Error("REST email needs KEYLOOP_EMAIL_ACCOUNT_ID, the 32-character hexadecimal account ID");
  }
  const grafanaOtlpEndpoint = setting(source, "KEYLOOP_GRAFANA_OTLP_ENDPOINT", "");
  if (otlpRelayEnabled === "true" && !grafanaTracesUrl(grafanaOtlpEndpoint)) {
    throw new Error("The OTLP relay needs KEYLOOP_GRAFANA_OTLP_ENDPOINT as https://otlp-gateway-<region>.grafana.net/otlp");
  }
  const emailAllowedAddresses = setting(source, "KEYLOOP_EMAIL_ALLOWED_ADDRESSES", "");
  const emailAllowedDomains = setting(source, "KEYLOOP_EMAIL_ALLOWED_DOMAINS", "");
  recipientAllowlist(emailAllowedAddresses, emailAllowedDomains, notificationsEnabled === "true");
  const caps = emailCaps(setting(source, "KEYLOOP_EMAIL_MAX_PER_RECIPIENT_PER_DAY", "10"),
    setting(source, "KEYLOOP_EMAIL_MAX_PER_DAY", "100"));
  return {
    secretsStoreId, apiImage, notificationsEnabled, emailSendingEnabled, emailTransport, emailAccountId,
    emailAllowedAddresses, emailAllowedDomains, emailMaxPerRecipientPerDay: caps.perRecipient, emailMaxPerDay: caps.perDay,
    otlpRelayEnabled, grafanaOtlpEndpoint,
    triageEnabled, triageAccountId, triageGatewayId, triageBucket,
  };
}
