import { configList, isMailbox, isReservedDomain, SENDER } from "./email/policy.ts";
import { requiredSecret } from "./secrets.ts";

type ContainerEnv = Pick<Env, "DB_URL" | "NOTIFICATIONS_ENABLED" | "NOTIFY_FROM_NAME" | "EMAIL_ALLOWED_ADDRESSES" |
  "EMAIL_ALLOWED_DOMAINS" | "EMAIL_MAX_PER_RECIPIENT_PER_DAY" | "EMAIL_MAX_PER_DAY">;

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
  const { addresses, domains } = recipientAllowlist(env.EMAIL_ALLOWED_ADDRESSES, env.EMAIL_ALLOWED_DOMAINS,
    env.NOTIFICATIONS_ENABLED === "true");
  const caps = emailCaps(env.EMAIL_MAX_PER_RECIPIENT_PER_DAY, env.EMAIL_MAX_PER_DAY);
  const db = await requiredSecret(env.DB_URL, "keyloop_prod_db_url");
  const result: Record<string, string> = {
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
    Notifications__Enabled: env.NOTIFICATIONS_ENABLED === "true" ? "true" : "false",
    Notifications__Provider: "Cloudflare",
    Notifications__FromAddress: SENDER,
    Notifications__FromDisplayName: env.NOTIFY_FROM_NAME,
    Notifications__Relay__BaseUrl: "http://email.internal",
    Notifications__Recipients__Mode: "AllowList",
    Notifications__Recipients__MaxPerRecipientPerDay: caps.perRecipient,
    Notifications__Recipients__MaxPerDay: caps.perDay,
    Logging__Console__FormatterName: "json",
  };
  addresses.forEach((value, index) => { result[`Notifications__Recipients__AllowedAddresses__${index}`] = value; });
  domains.forEach((value, index) => { result[`Notifications__Recipients__AllowedDomains__${index}`] = value; });
  return result;
}
