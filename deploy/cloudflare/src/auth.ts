import { configList, isMailbox } from "./email/policy.ts";

// Shared startup validation; diagnostics name the setting and never print a role member.
export function accessSettings(teamDomain: string, audience: string, admin: string, advisor: string, viewer: string) {
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(teamDomain)) {
    throw new Error("Configure the Access team domain as https://<team>.cloudflareaccess.com");
  }
  const audiences = [...new Set(audience.split(",").map(value => value.trim()).filter(Boolean))];
  if (audiences.length === 0 || audiences.some(value => /\s/.test(value))) throw new Error("Configure an Access audience AUD tag");
  const roles = { Admin: configList(admin), ServiceAdvisor: configList(advisor), Viewer: configList(viewer) };
  if (Object.values(roles).flat().some(value => value.startsWith("@") ? !isMailbox(`member${value}`) : !isMailbox(value))) {
    throw new Error("Configure valid Access role members");
  }
  return { teamDomain, audiences, roles };
}
