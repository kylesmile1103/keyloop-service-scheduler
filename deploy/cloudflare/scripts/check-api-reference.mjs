// Browser check for the static API reference: serves build/assets (run `npm run assemble` first) through Miniflare's
// Static Assets pipeline with public/_headers and the real edge router (a fake API Durable Object answers /api/*), then
// loads /scalar/v1 in headless Chromium in light, dark and phone layouts. It fails on any CSP violation, request to
// another origin, link to another origin (other than Scalar's credit and MDN's page for a response status, below), console
// error or contract operation that did not render, and checks that "Test Request" reaches this origin. Local only: no
// account, no network beyond 127.0.0.1.
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core node scripts/check-api-reference.mjs [screenshot directory]
//
// playwright-core and a Chromium build are not dependencies of this package; point PLAYWRIGHT_CORE at an installed copy.
// `--scalar-defaults` replaces the page's configuration with Scalar's defaults, to show the check detects the font CDN
// and eval violations that configuration avoids (it is expected to fail).
import { mkdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare, Response as MiniflareResponse } from "miniflare";

const args = process.argv.slice(2);
const scalarDefaults = args.includes("--scalar-defaults");
const shots = args.find(arg => !arg.startsWith("--"));
const playwrightPath = process.env.PLAYWRIGHT_CORE;
const { chromium } = await import(playwrightPath ? pathToFileURL(`${playwrightPath.replace(/\/$/, "")}/index.mjs`).href : "playwright-core");

const edge = new URL("../", import.meta.url);
const contract = JSON.parse(await readFile(new URL("../../contracts/openapi/v1.json", edge), "utf8"));
const operations = Object.entries(contract.paths).flatMap(([path, item]) => Object.entries(item)
  .filter(([method]) => ["get", "put", "post", "patch", "delete"].includes(method))
  .map(([method, operation]) => ({ id: `${method.toUpperCase()} ${path}`, summary: operation.summary })));

const worker = await build({ entryPoints: [new URL("test/runtime-entry.ts", edge).pathname], bundle: true, format: "esm",
  platform: "browser", write: false, external: ["cloudflare:workers"] });
const mf = new Miniflare(convertV4MiniflareOptions({
  name: "keyloop-api-reference-check", modules: true, script: worker.outputFiles[0].text,
  compatibilityDate: "2026-10-11", compatibilityFlags: ["nodejs_compat"], cf: false, host: "127.0.0.1", port: 0,
  unsafeDevRegistryPath: new URL("build/api-reference-check-registry/", edge).pathname,
  durableObjects: { API: { className: "FakeApi", useSQLite: true } },
  assets: {
    directory: new URL("build/assets/", edge).pathname, binding: "ASSETS",
    run_worker_first: ["/api", "/api/*", "/auth/*", "/otlp", "/otlp/*"],
    routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: "single-page-application" },
  },
  outboundService: () => new MiniflareResponse("Network forbidden", { status: 503 }),
}));
const origin = new URL(await mf.ready).origin;
if (shots) await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = {};
let failed = false;

try {
  for (const [layout, options] of [
    ["desktop-light", { viewport: { width: 1440, height: 900 }, colorScheme: "light" }],
    ["desktop-dark", { viewport: { width: 1440, height: 900 }, colorScheme: "dark" }],
    ["phone", { viewport: { width: 390, height: 844 }, colorScheme: "light", deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    const context = await browser.newContext(options);
    // A fixture Access cookie as /auth/login would set it: writes from "Test Request" need it to reach the API.
    await context.addCookies([{ name: "CF_Authorization", value: "local-fixture-cookie", url: origin, httpOnly: true, sameSite: "Lax" }]);
    // Block anything that is not this origin, after recording it, so the check never reaches the network.
    const foreign = [];
    await context.route(url => !url.href.startsWith(origin) && !/^(data|blob):/.test(url.protocol), route => {
      foreign.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    // Links, not requests: Scalar's "Open API Client" button links to its hosted client, which would then send "Test Request"
    // calls through Scalar's proxy. Collected again once "Test Request" has opened the client modal, where that button also
    // appears, and after its response. Two kinds are accepted, and nothing else: Scalar's credit to its home page ("Powered by
    // Scalar" in the sidebar, "Powered By Scalar.com" in the client modal), and the MDN page for the response's status code,
    // which the client links from every response's status and no option turns off. Neither carries API data.
    const offSiteLinks = new Set();
    const acceptedLinks = new Set();
    const collectOffSiteLinks = async () => {
      for (const { link, accepted } of await page.evaluate(() => [...document.querySelectorAll("a[href], area[href]")]
        .map(element => ({ url: new URL(element.href), text: element.textContent.trim().replace(/\s+/g, " ") }))
        .filter(({ url }) => /^https?:$/.test(url.protocol) && url.origin !== location.origin)
        .map(({ url, text }) => ({
          link: `${text.slice(0, 40)} -> ${url.href}`,
          accepted: (/^Powered by Scalar(\.com)?$/i.test(text) && /^https:\/\/(www\.)?scalar\.com$/.test(url.origin) && url.pathname === "/") ||
            (url.origin === "https://developer.mozilla.org" && /^\/en-US\/docs\/Web\/HTTP\/Status\/\d{3}$/.test(url.pathname) && !url.search &&
              text.startsWith(url.pathname.slice(-3))),
        })))) (accepted ? acceptedLinks : offSiteLinks).add(link);
    };
    const consoleErrors = [];
    const sameOriginApi = [];
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("request", async request => {
      if (!request.url().startsWith(`${origin}/api/`)) return;
      const cookie = (await request.allHeaders()).cookie ?? "";
      sameOriginApi.push(`${request.method()} ${request.url().slice(origin.length)}${cookie.includes("CF_Authorization=local-fixture-cookie") ? " (Access cookie sent)" : ""}`);
    });
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", event => {
        window.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
      });
    });
    if (scalarDefaults) {
      await page.route(`${origin}/scalar/before.js`, route => route.fulfill({ contentType: "text/javascript", body: "" }));
      await page.route(`${origin}/scalar/config.js`, route => route.fulfill({ contentType: "text/javascript",
        body: 'Scalar.createApiReference("#keyloop-api-reference", { url: "/openapi/v1.json" })' }));
    }
    const response = await page.goto(`${origin}/scalar/v1`, { waitUntil: "load" });
    await page.waitForFunction(summary => document.body.textContent.includes(summary), operations.at(-1).summary, { timeout: 30_000 })
      .catch(() => {});
    await page.waitForTimeout(1_500);
    const text = await page.evaluate(() => document.body.textContent);
    const result = {
      status: response.status(),
      csp: response.headers()["content-security-policy"],
      darkMode: await page.evaluate(() => document.body.classList.contains("dark-mode")),
      operations: operations.length,
      missing: operations.filter(operation => !text.includes(operation.summary)).map(operation => operation.id),
    };
    if (shots) await page.screenshot({ path: `${shots}/scalar-v1-${layout}.png` });
    await collectOffSiteLinks();
    if (layout === "phone") {
      // The phone layout renders its sidebar, and so the sidebar's links, once the menu is open.
      await page.mouse.click(28, 25);
      await page.waitForTimeout(800);
      if (shots) await page.screenshot({ path: `${shots}/scalar-v1-phone-menu.png` });
      await collectOffSiteLinks();
    }
    if (layout.startsWith("desktop") && result.missing.length === 0) {
      result.curlExample = await page.evaluate(() => [...document.querySelectorAll("pre, code")].map(element => element.textContent)
        .find(snippet => snippet.includes("curl"))?.replace(/\s+/g, " ").slice(0, 80));
      if (layout === "desktop-light") {
        await page.getByRole("button", { name: /Test Request/i }).first().click();
        await page.waitForTimeout(1_000);
        await collectOffSiteLinks();
        await page.getByRole("button", { name: /^Send/i }).first().click();
        await page.waitForTimeout(1_500);
        if (shots) await page.screenshot({ path: `${shots}/scalar-v1-test-request.png` });
        result.testRequests = [...sameOriginApi];
        await collectOffSiteLinks();
      }
    }
    result.offSiteLinks = [...offSiteLinks];
    result.acceptedLinks = [...acceptedLinks];
    result.cspViolations = await page.evaluate(() => window.__cspViolations);
    result.foreignRequests = foreign;
    result.consoleErrors = consoleErrors;
    const ok = result.status === 200 && result.missing.length === 0 && result.cspViolations.length === 0 &&
      result.foreignRequests.length === 0 && result.offSiteLinks.length === 0 && result.consoleErrors.length === 0 &&
      (layout !== "desktop-dark" || result.darkMode) &&
      (!layout.startsWith("desktop") || result.curlExample?.includes(`curl ${origin}/api/`) || result.curlExample?.includes(`curl '${origin}/api/`)) &&
      (layout !== "desktop-light" || (result.testRequests ?? []).some(entry => entry.endsWith("(Access cookie sent)")));
    failed ||= !ok;
    results[layout] = { ok, ...result };
    await context.close();
  }
} finally {
  await browser.close();
  await mf.dispose();
}
console.log(JSON.stringify({ origin, scalarDefaults, results }, null, 2));
process.exitCode = failed ? 1 : 0;
