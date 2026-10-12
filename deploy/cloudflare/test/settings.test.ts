import { describe, expect, it } from "vitest";
import { edgeSettings } from "../src/settings";

const identifiers = {
  KEYLOOP_ACCESS_TEAM_DOMAIN: "https://local-fixture.cloudflareaccess.com",
  KEYLOOP_ACCESS_AUDIENCE: "local-validation-audience",
  KEYLOOP_SECRETS_STORE_ID: "00000000000000000000000000000000",
  KEYLOOP_API_IMAGE: "registry.cloudflare.com/00000000000000000000000000000000/keyloop-scheduler-api:test",
};

const apiOtlp = {
  KEYLOOP_API_OTLP_ENABLED: "true",
  KEYLOOP_GRAFANA_OTLP_ENDPOINT: "https://otlp-gateway-local.grafana.net/otlp",
  KEYLOOP_GRAFANA_INSTANCE_ID: "123456",
};

describe("edge settings evaluated by cloudflare.config.ts", () => {
  it("defaults every integration off with the binding transport and the documented caps", () => {
    expect(edgeSettings({ ...identifiers, KEYLOOP_EMAIL_TRANSPORT: "", KEYLOOP_EMAIL_MAX_PER_DAY: "" })).toEqual({
      secretsStoreId: identifiers.KEYLOOP_SECRETS_STORE_ID, apiImage: identifiers.KEYLOOP_API_IMAGE,
      authTeamDomain: identifiers.KEYLOOP_ACCESS_TEAM_DOMAIN, authAudience: identifiers.KEYLOOP_ACCESS_AUDIENCE,
      authAdmin: "", authServiceAdvisor: "", authViewer: "",
      notificationsEnabled: "false", emailSendingEnabled: "false", emailTransport: "binding", emailAccountId: "",
      emailAllowedAddresses: "", emailAllowedDomains: "", emailMaxPerRecipientPerDay: "10", emailMaxPerDay: "100",
      otlpRelayEnabled: "false", grafanaOtlpEndpoint: "", apiOtlpEnabled: "false", grafanaInstanceId: "",
      triageEnabled: "false", triageAccountId: "", triageGatewayId: "keyloop-scheduler", triageBucket: "keyloop-scheduler-triage",
      vehicleAwareRequirements: "false",
    });
  });
  it("accepts API telemetry with the gateway endpoint and the stack's numeric instance ID", () => {
    expect(edgeSettings({
      ...identifiers, KEYLOOP_API_OTLP_ENABLED: "true", KEYLOOP_GRAFANA_INSTANCE_ID: "123456",
      KEYLOOP_GRAFANA_OTLP_ENDPOINT: "https://otlp-gateway-prod-eu-west-2.grafana.net/otlp",
    })).toMatchObject({
      apiOtlpEnabled: "true", grafanaInstanceId: "123456", otlpRelayEnabled: "false",
      grafanaOtlpEndpoint: "https://otlp-gateway-prod-eu-west-2.grafana.net/otlp",
    });
  });
  it("leaves API telemetry off when only its identifiers are configured", () => {
    expect(edgeSettings({
      ...identifiers, KEYLOOP_GRAFANA_INSTANCE_ID: "123456", KEYLOOP_GRAFANA_OTLP_ENDPOINT: "https://otlp-gateway-local.grafana.net/otlp",
    })).toMatchObject({ apiOtlpEnabled: "false", grafanaInstanceId: "123456" });
  });
  it("switches vehicle-aware requirements on only when asked", () => {
    expect(edgeSettings({ ...identifiers, KEYLOOP_VEHICLE_AWARE_REQUIREMENTS: "true" })).toMatchObject({ vehicleAwareRequirements: "true" });
    expect(edgeSettings({ ...identifiers, KEYLOOP_VEHICLE_AWARE_REQUIREMENTS: "false" })).toMatchObject({ vehicleAwareRequirements: "false" });
    expect(edgeSettings({ ...identifiers, KEYLOOP_VEHICLE_AWARE_REQUIREMENTS: "" })).toMatchObject({ vehicleAwareRequirements: "false" });
  });
  it("accepts a complete REST, notification and OTLP profile", () => {
    expect(edgeSettings({
      ...identifiers, KEYLOOP_EMAIL_TRANSPORT: "rest", KEYLOOP_EMAIL_ACCOUNT_ID: "0123456789abcdef0123456789ABCDEF",
      KEYLOOP_NOTIFICATIONS_ENABLED: "true", KEYLOOP_EMAIL_SENDING_ENABLED: "true",
      KEYLOOP_EMAIL_ALLOWED_ADDRESSES: "reviewer@keyloop.kylesmile.me", KEYLOOP_EMAIL_MAX_PER_DAY: "40",
      KEYLOOP_OTLP_RELAY_ENABLED: "true", KEYLOOP_GRAFANA_OTLP_ENDPOINT: "https://otlp-gateway-prod-eu-west-2.grafana.net/otlp",
    })).toMatchObject({ emailTransport: "rest", notificationsEnabled: "true", emailMaxPerDay: "40", otlpRelayEnabled: "true" });
  });
  it.each([
    [{ KEYLOOP_SECRETS_STORE_ID: " " }, "Set KEYLOOP_SECRETS_STORE_ID"],
    [{ KEYLOOP_API_IMAGE: undefined }, "Set KEYLOOP_API_IMAGE"],
    [{ KEYLOOP_EMAIL_TRANSPORT: "REST" }, "binding or rest"],
    [{ KEYLOOP_EMAIL_TRANSPORT: "smtp" }, "binding or rest"],
    [{ KEYLOOP_EMAIL_TRANSPORT: "rest" }, "KEYLOOP_EMAIL_ACCOUNT_ID"],
    [{ KEYLOOP_EMAIL_TRANSPORT: "rest", KEYLOOP_EMAIL_ACCOUNT_ID: "not-an-account" }, "KEYLOOP_EMAIL_ACCOUNT_ID"],
    [{ KEYLOOP_EMAIL_SENDING_ENABLED: "TRUE" }, "KEYLOOP_EMAIL_SENDING_ENABLED to true or false"],
    [{ KEYLOOP_NOTIFICATIONS_ENABLED: "yes" }, "KEYLOOP_NOTIFICATIONS_ENABLED to true or false"],
    [{ KEYLOOP_OTLP_RELAY_ENABLED: "true" }, "KEYLOOP_GRAFANA_OTLP_ENDPOINT"],
    [{ KEYLOOP_OTLP_RELAY_ENABLED: "true", KEYLOOP_GRAFANA_OTLP_ENDPOINT: "http://otlp-gateway-local.grafana.net/otlp" }, "KEYLOOP_GRAFANA_OTLP_ENDPOINT"],
    [{ KEYLOOP_OTLP_RELAY_ENABLED: "true", KEYLOOP_GRAFANA_OTLP_ENDPOINT: "https://otlp-gateway-local.grafana.net/otlp/" }, "KEYLOOP_GRAFANA_OTLP_ENDPOINT"],
    [{ KEYLOOP_NOTIFICATIONS_ENABLED: "true" }, "approved recipient allowlist"],
    [{ KEYLOOP_EMAIL_ALLOWED_ADDRESSES: "reviewer@example.com" }, "non-reserved notification allowlist"],
    [{ KEYLOOP_EMAIL_MAX_PER_DAY: "10001" }, "valid daily email cap"],
    [{ KEYLOOP_EMAIL_MAX_PER_RECIPIENT_PER_DAY: "0" }, "valid per-recipient email cap"],
    [{ KEYLOOP_VEHICLE_AWARE_REQUIREMENTS: "TRUE" }, "KEYLOOP_VEHICLE_AWARE_REQUIREMENTS to true or false"],
    [{ KEYLOOP_VEHICLE_AWARE_REQUIREMENTS: "yes" }, "KEYLOOP_VEHICLE_AWARE_REQUIREMENTS to true or false"],
    [{ KEYLOOP_API_OTLP_ENABLED: "yes" }, "KEYLOOP_API_OTLP_ENABLED to true or false"],
    [{ ...apiOtlp, KEYLOOP_API_OTLP_ENABLED: "TRUE" }, "KEYLOOP_API_OTLP_ENABLED to true or false"],
    [{ ...apiOtlp, KEYLOOP_GRAFANA_OTLP_ENDPOINT: "" }, "API telemetry needs KEYLOOP_GRAFANA_OTLP_ENDPOINT"],
    [{ ...apiOtlp, KEYLOOP_GRAFANA_OTLP_ENDPOINT: "https://otlp-gateway-local.grafana.net/otlp/" }, "API telemetry needs KEYLOOP_GRAFANA_OTLP_ENDPOINT"],
    [{ ...apiOtlp, KEYLOOP_GRAFANA_OTLP_ENDPOINT: "https://otlp-gateway-local.grafana.net/otlp/v1/traces" }, "API telemetry needs KEYLOOP_GRAFANA_OTLP_ENDPOINT"],
    [{ ...apiOtlp, KEYLOOP_GRAFANA_OTLP_ENDPOINT: "http://otlp-gateway-local.grafana.net/otlp" }, "API telemetry needs KEYLOOP_GRAFANA_OTLP_ENDPOINT"],
    [{ ...apiOtlp, KEYLOOP_GRAFANA_OTLP_ENDPOINT: "https://collector.example.com/otlp" }, "API telemetry needs KEYLOOP_GRAFANA_OTLP_ENDPOINT"],
    [{ ...apiOtlp, KEYLOOP_GRAFANA_INSTANCE_ID: "" }, "KEYLOOP_GRAFANA_INSTANCE_ID"],
    [{ ...apiOtlp, KEYLOOP_GRAFANA_INSTANCE_ID: "stack-123456" }, "KEYLOOP_GRAFANA_INSTANCE_ID"],
    [{ ...apiOtlp, KEYLOOP_GRAFANA_INSTANCE_ID: "123 456" }, "KEYLOOP_GRAFANA_INSTANCE_ID"],
    [{ ...apiOtlp, KEYLOOP_GRAFANA_INSTANCE_ID: "123456:token" }, "KEYLOOP_GRAFANA_INSTANCE_ID"],
    [{ ...apiOtlp, KEYLOOP_GRAFANA_INSTANCE_ID: "1".repeat(21) }, "KEYLOOP_GRAFANA_INSTANCE_ID"],
    [{ KEYLOOP_GRAFANA_INSTANCE_ID: "-1" }, "KEYLOOP_GRAFANA_INSTANCE_ID"],
  ])("fails the build for %o", (overrides, message) => {
    expect(() => edgeSettings({ ...identifiers, ...overrides })).toThrow(message);
  });
});
