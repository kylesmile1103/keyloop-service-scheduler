import { configList, isMailbox, isReservedDomain, SENDER } from "./email/policy";
import { requiredSecret } from "./secrets";

type ContainerEnv = Pick<Env, "DB_URL" | "NOTIFICATIONS_ENABLED" | "NOTIFY_FROM_NAME" | "EMAIL_ALLOWED_ADDRESSES" |
  "EMAIL_ALLOWED_DOMAINS" | "EMAIL_MAX_PER_RECIPIENT_PER_DAY" | "EMAIL_MAX_PER_DAY">;

function validatedCap(value: string, max: number, name: string): string {
  if (!/^[1-9]\d*$/.test(value) || Number(value) > max) throw new Error(`Configure a valid ${name}`);
  return value;
}

export async function containerEnv(env: ContainerEnv): Promise<Record<string, string>> {
  const db = await requiredSecret(env.DB_URL, "keyloop_prod_db_url");
  const addresses = configList(env.EMAIL_ALLOWED_ADDRESSES);
  const domains = configList(env.EMAIL_ALLOWED_DOMAINS);
  if (addresses.some(value => !isMailbox(value) || isReservedDomain(value.split("@")[1]!)) ||
      domains.some(value => !isMailbox(`reviewer@${value}`) || isReservedDomain(value))) {
    throw new Error("Configure a valid non-reserved notification allowlist");
  }
  if (env.NOTIFICATIONS_ENABLED === "true" && addresses.length + domains.length === 0) {
    throw new Error("Notifications require an approved recipient allowlist");
  }
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
    Notifications__Recipients__MaxPerRecipientPerDay: validatedCap(env.EMAIL_MAX_PER_RECIPIENT_PER_DAY, 1000, "per-recipient email cap"),
    Notifications__Recipients__MaxPerDay: validatedCap(env.EMAIL_MAX_PER_DAY, 10000, "daily email cap"),
    Logging__Console__FormatterName: "json",
  };
  addresses.forEach((value, index) => { result[`Notifications__Recipients__AllowedAddresses__${index}`] = value; });
  domains.forEach((value, index) => { result[`Notifications__Recipients__AllowedDomains__${index}`] = value; });
  return result;
}
