import { accessSettings } from "./auth.ts";
import { configList, isMailbox, isReservedDomain, SENDER } from "./email/policy.ts";
import { requiredSecret } from "./secrets.ts";

type ContainerEnv = Pick<Env, "DB_URL" | "NOTIFICATIONS_ENABLED" | "NOTIFY_FROM_NAME" | "EMAIL_ALLOWED_ADDRESSES" |
  "EMAIL_ALLOWED_DOMAINS" | "EMAIL_MAX_PER_RECIPIENT_PER_DAY" | "EMAIL_MAX_PER_DAY" |
  "AUTH_TEAM_DOMAIN" | "AUTH_AUDIENCE" | "AUTH_ADMIN" | "AUTH_SERVICE_ADVISOR" | "AUTH_VIEWER" |
  "TRIAGE_ENABLED" | "TRIAGE_ACCOUNT_ID" | "TRIAGE_GATEWAY_ID" | "AI_TOKEN">;

export function triageSettings(enabled: string, account: string, gateway: string): void {
  if (enabled !== "true" && enabled !== "false") throw new Error("Set KEYLOOP_TRIAGE_ENABLED to true or false");
  if (enabled === "true" && !/^[a-f0-9]{32}$/i.test(account)) throw new Error("Set KEYLOOP_TRIAGE_ACCOUNT_ID to a 32-character hexadecimal account ID");
  if (!/^[a-z0-9-]{1,64}$/i.test(gateway)) throw new Error("Configure a valid triage gateway slug");
}

function validatedCap(value: string, max: number, name: string): string {
  if (!/^[1-9]\d*$/.test(value) || Number(value) > max) throw new Error(`Configure a valid ${name}`);
  return value;
}

// Shared with settings.ts, so `cf build` refuses the same values a container start would.
export function emailCaps(perRecipient: string, perDay: string): { perRecipient: string; perDay: string } {
  return {
    perRecipient: validatedCap(perRecipient, 1000, "per-recipient email cap"),
    perDay: validatedCap(perDay, 10000, "daily email cap"),
  };
}

export function recipientAllowlist(addressList: string, domainList: string, notificationsEnabled: boolean):
  { addresses: string[]; domains: string[] } {
  const addresses = configList(addressList);
  const domains = configList(domainList);
  if (addresses.some(value => !isMailbox(value) || isReservedDomain(value.split("@")[1]!)) ||
      domains.some(value => !isMailbox(`reviewer@${value}`) || isReservedDomain(value))) {
    throw new Error("Configure a valid non-reserved notification allowlist");
  }
  if (notificationsEnabled && addresses.length + domains.length === 0) {
    throw new Error("Notifications require an approved recipient allowlist");
  }
  return { addresses, domains };
}

export async function containerEnv(env: ContainerEnv): Promise<Record<string, string>> {
  const access = accessSettings(env.AUTH_TEAM_DOMAIN, env.AUTH_AUDIENCE, env.AUTH_ADMIN, env.AUTH_SERVICE_ADVISOR, env.AUTH_VIEWER);
  triageSettings(env.TRIAGE_ENABLED, env.TRIAGE_ACCOUNT_ID, env.TRIAGE_GATEWAY_ID);
  const notificationsEnabled = env.NOTIFICATIONS_ENABLED === "true";
  const { addresses, domains } = recipientAllowlist(env.EMAIL_ALLOWED_ADDRESSES, env.EMAIL_ALLOWED_DOMAINS, notificationsEnabled);
  const caps = emailCaps(env.EMAIL_MAX_PER_RECIPIENT_PER_DAY, env.EMAIL_MAX_PER_DAY);
  const db = await requiredSecret(env.DB_URL, "keyloop_prod_db_url");
  const result: Record<string, string> = {
    Auth__Mode: "CloudflareAccess",
    Auth__TeamDomain: access.teamDomain,
    ASPNETCORE_ENVIRONMENT: "Production",
    ASPNETCORE_HTTP_PORTS: "8080",
    ConnectionStrings__schedulerdb: db,
    Database__MigrateOnStartup: "false",
    Database__SeedDemoData: "true",
    Demo__ReseedKey: "",
    Security__ForwardedHeaders__Enabled: "true",
    Security__ForwardedHeaders__KnownNetworks__0: "0.0.0.0/0",
    Security__ForwardedHeaders__KnownNetworks__1: "::/0",
    Security__RateLimiting__BookingPermitsPerMinute: "120",
    Notifications__Enabled: notificationsEnabled ? "true" : "false",
    // The API refuses to start with the reserved Cloudflare provider, enabled or not, until its relay adapter exists (ARCHITECTURE
    // section 10). Disabled notifications therefore select None, so a core deployment starts; enabling them still fails loudly.
    Notifications__Provider: notificationsEnabled ? "Cloudflare" : "None",
    Notifications__FromAddress: SENDER,
    Notifications__FromDisplayName: env.NOTIFY_FROM_NAME,
    Notifications__Relay__BaseUrl: "http://email.internal",
    Notifications__Recipients__Mode: "AllowList",
    Notifications__Recipients__MaxPerRecipientPerDay: caps.perRecipient,
    Notifications__Recipients__MaxPerDay: caps.perDay,
    Logging__Console__FormatterName: "json",
    Triage__Enabled: env.TRIAGE_ENABLED,
  };
  if (env.TRIAGE_ENABLED === "true") {
    result.Triage__Model = "@cf/cloudflare/clef-flash";
    result.Triage__ImagesEnabled = "true";
    result.Triage__ImageStoreUrl = "http://triage-media.internal";
    result.Triage__AccountId = env.TRIAGE_ACCOUNT_ID;
    result.Triage__GatewayId = env.TRIAGE_GATEWAY_ID;
    result.Triage__ApiToken = await requiredSecret(env.AI_TOKEN, "keyloop_prod_ai_token");
  }
  addresses.forEach((value, index) => { result[`Notifications__Recipients__AllowedAddresses__${index}`] = value; });
  domains.forEach((value, index) => { result[`Notifications__Recipients__AllowedDomains__${index}`] = value; });
  access.audiences.forEach((value, index) => { result[`Auth__Audience__${index}`] = value; });
  Object.entries(access.roles).forEach(([role, members]) => members.forEach((value, index) => {
    result[`Auth__Roles__${role}__${index}`] = value;
  }));
  return result;
}
