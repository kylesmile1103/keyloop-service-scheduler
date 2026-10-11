export const SENDER = "notifications@keyloop.kylesmile.me";

export function isMailbox(value: unknown): value is string {
  // The relay accepts one bare mailbox, never display names, lists or header syntax.
  return typeof value === "string" && value.length <= 254 &&
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(value) &&
    !value.includes("..") && value.split("@")[1]!.split(".").every(label =>
      label.length > 0 && label.length <= 63 && !label.startsWith("-") && !label.endsWith("-"));
}

export function configList(value: string): string[] {
  return [...new Set(value.split(",").map(item => item.trim().toLowerCase()).filter(Boolean))];
}

export function isReservedDomain(domain: string): boolean {
  const name = domain.toLowerCase();
  return ["example.com", "example.net", "example.org", "example", "test", "invalid", "localhost"]
    .some(reserved => name === reserved || name.endsWith(`.${reserved}`));
}

export function recipientRefusal(to: string, env: Pick<Env, "EMAIL_ALLOWED_ADDRESSES" | "EMAIL_ALLOWED_DOMAINS">): string | null {
  const address = to.toLowerCase();
  const domain = address.split("@")[1]!;
  if (isReservedDomain(domain)) return "E_RESERVED_DOMAIN";
  const addresses = configList(env.EMAIL_ALLOWED_ADDRESSES);
  const domains = configList(env.EMAIL_ALLOWED_DOMAINS);
  return addresses.includes(address) || domains.includes(domain) ? null : "E_RECIPIENT_NOT_ALLOWLISTED";
}
