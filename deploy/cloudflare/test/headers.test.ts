import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
const nginxPath = new URL("../../../src/Keyloop.ServiceScheduler.Web/nginx/security-headers.conf", import.meta.url);
const nginx = readFileSync(existsSync(nginxPath) ? nginxPath : new URL("./fixtures/nginx-security-headers.conf", import.meta.url), "utf8");

describe("asset security headers", () => {
  it("matches every nginx static security header", () => {
    const declarations = [...nginx.matchAll(/^add_header ([\w-]+) "([^"]+)" always;/gm)];
    expect(declarations.length).toBeGreaterThanOrEqual(6);
    for (const [, name, value] of declarations) expect(headers).toContain(`  ${name}: ${value}`);
  });
  it("sets one immutable-cache rule for hashed assets and host-only HSTS", () => {
    expect(headers.match(/Cache-Control:/g)).toHaveLength(1);
    expect(headers).toContain("/assets/*\n  Cache-Control: public, max-age=31536000, immutable");
    expect(headers).toContain("Strict-Transport-Security: max-age=31536000");
    expect(headers).not.toContain("includeSubDomains");
    expect(headers).not.toContain("preload");
  });
  it("serves the static API reference under the site CSP, with no path-specific relaxation", () => {
    expect(headers.match(/Content-Security-Policy:/g)).toHaveLength(1);
    expect(headers.split("\n").filter(line => line.startsWith("/"))).toEqual(["/*", "/assets/*"]);
    const csp = headers.match(/Content-Security-Policy: (.+)/)![1]!;
    const directive = (name: string) => csp.split(";").map(part => part.trim()).find(part => part.startsWith(`${name} `));
    expect(directive("script-src")).toBe("script-src 'self'");
    expect(directive("font-src")).toBe("font-src 'self'");
    expect(directive("connect-src")).toBe("connect-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
  });
});
