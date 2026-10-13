import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare, Response as MiniflareResponse } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assembleAssets } from "../scripts/assemble-assets.mjs";

const source = new URL("../build/runtime-tests-spa/", import.meta.url);
const directory = new URL("../build/runtime-tests/", import.meta.url);
let mf: Miniflare;

beforeAll(async () => {
  // The real assembly: a fixture SPA plus the static API reference, the committed contract and public/_headers.
  await mkdir(new URL("assets/", source), { recursive: true });
  await writeFile(new URL("index.html", source), "<!doctype html><title>SPA runtime fixture</title>");
  await writeFile(new URL("assets/app-hash.js", source), "console.log('runtime fixture');");
  await assembleAssets(source, directory);
  const result = await build({ entryPoints: [new URL("./runtime-entry.ts", import.meta.url).pathname],
    bundle: true, format: "esm", platform: "browser", write: false, external: ["cloudflare:workers"] });
  mf = new Miniflare(convertV4MiniflareOptions({
    name: "keyloop-edge-runtime-test", modules: true, script: result.outputFiles[0]!.text,
    // The machine is still 2026-10-11 UTC. Miniflare refuses a future UTC date.
    compatibilityDate: "2026-10-11", compatibilityFlags: ["nodejs_compat"],
    cf: false,
    unsafeDevRegistryPath: new URL("../build/dev-registry/", import.meta.url).pathname,
    durableObjects: { API: { className: "FakeApi", useSQLite: true } },
    assets: {
      directory: directory.pathname, binding: "ASSETS", run_worker_first: ["/api", "/api/*", "/auth/*", "/otlp", "/otlp/*"],
      routerConfig: { has_user_worker: true },
      assetConfig: { not_found_handling: "single-page-application" },
    },
    // Test runtime cannot open an external service or send telemetry.
    outboundService: () => new MiniflareResponse("Network forbidden", { status: 503 }),
  }));
  await mf.ready;
}, 30_000);

afterAll(async () => {
  await mf?.dispose();
  await rm(directory, { recursive: true, force: true });
  await rm(source, { recursive: true, force: true });
});

describe("Miniflare asset and Worker routing", () => {
  it.each(["/", "/board/deep/link", "/apix", "/health", "/alive", "/scalar"])("serves SPA fallback for %s", async path => {
    const result = await mf.dispatchFetch(`https://keyloop.kylesmile.me${path}`, { headers: { "sec-fetch-mode": "navigate" } });
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toContain("text/html");
    expect(await result.text()).toContain("SPA runtime fixture");
    expect(result.headers.get("x-frame-options")).toBe("DENY");
    expect(result.headers.get("content-security-policy")).toContain("connect-src 'self'");
  });
  it.each(["/api", "/api/v1/dealerships", "/api/v1/does-not-exist", "/auth/login"])("routes navigation to %s to the DO with JSON and trusted headers", async path => {
    const result = await mf.dispatchFetch(`https://keyloop.kylesmile.me${path}`, {
      headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "forged", "x-forwarded-proto": "http" },
    });
    expect(result.status, await result.clone().text()).toBe(200);
    expect(result.headers.get("content-type")).toContain("application/json");
    expect(result.headers.has("content-security-policy")).toBe(false);
    expect(await result.json()).toEqual({ api: true, path, forwardedFor: "203.0.113.9", forwardedProto: "https" });
  });
  it("serves immutable hashed assets through the platform asset pipeline", async () => {
    const result = await mf.dispatchFetch("https://keyloop.kylesmile.me/assets/app-hash.js");
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });
  it("does not serve an OTLP navigation as index.html", async () => {
    const result = await mf.dispatchFetch("https://keyloop.kylesmile.me/otlp/v1/metrics", { headers: { "sec-fetch-mode": "navigate" } });
    expect(result.status, await result.clone().text()).toBe(404);
    expect(result.headers.get("content-type")).toContain("application/json");
  });
  it("serves the static API reference at /scalar/v1 under the site CSP", async () => {
    const result = await mf.dispatchFetch("https://keyloop.kylesmile.me/scalar/v1", { headers: { "sec-fetch-mode": "navigate" } });
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toContain("text/html");
    expect(result.headers.get("content-security-policy")).toBe(siteCsp());
    const page = await result.text();
    expect(page).toContain('<script src="/scalar/standalone.js"></script>');
    expect(page).not.toContain("SPA runtime fixture");
  });
  it.each(["/scalar/v1/", "/scalar/v1.html"])("redirects %s to the canonical /scalar/v1", async path => {
    const result = await mf.dispatchFetch(`https://keyloop.kylesmile.me${path}`, { redirect: "manual" });
    expect(result.status).toBe(307);
    expect(new URL(result.headers.get("location")!, "https://keyloop.kylesmile.me").pathname).toBe("/scalar/v1");
  });
  it.each(["/scalar/before.js", "/scalar/standalone.js", "/scalar/config.js"])("serves %s as a script file", async path => {
    const result = await mf.dispatchFetch(`https://keyloop.kylesmile.me${path}`);
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toContain("javascript");
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    await result.body?.cancel();
  });
  it("serves the committed contract as JSON at /openapi/v1.json, not the API's runtime document", async () => {
    const result = await mf.dispatchFetch("https://keyloop.kylesmile.me/openapi/v1.json");
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toContain("application/json");
    expect(await result.text()).toBe(await readFile(new URL("../../../contracts/openapi/v1.json", import.meta.url), "utf8"));
  });
});

function siteCsp() {
  return "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; " +
    "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
}
