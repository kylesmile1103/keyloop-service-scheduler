import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { assembleAssets, REFERENCE_FILES } from "../scripts/assemble-assets.mjs";

const fixtures: URL[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const parent = new URL("../build/tmp/", import.meta.url);
  await mkdir(parent, { recursive: true });
  const root = pathToFileURL(`${await mkdtemp(fileURLToPath(new URL("asset-fixture-", parent)))}/`);
  fixtures.push(root);
  const source = new URL("dist/", root);
  const destination = new URL("assembled/", root);
  await mkdir(destination);
  await writeFile(new URL("index.html", destination), "existing assembled SPA");
  return { source, destination };
}

it("preserves the previous assembly if the SPA build is missing", async () => {
  const { source, destination } = await fixture();
  await expect(assembleAssets(source, destination)).rejects.toThrow("dist/index.html is required");
  expect(await readFile(new URL("index.html", destination), "utf8")).toBe("existing assembled SPA");
});

it("assembles the SPA with edge headers without altering the frontend dist", async () => {
  const { source, destination } = await fixture();
  await mkdir(new URL("assets/", source), { recursive: true });
  await writeFile(new URL("index.html", source), "<html>built SPA</html>");
  await writeFile(new URL("assets/app.hash.js", source), "console.log('fixture')");
  await assembleAssets(source, destination);
  expect(await readFile(new URL("index.html", destination), "utf8")).toBe("<html>built SPA</html>");
  expect(await readFile(new URL("assets/app.hash.js", destination), "utf8")).toBe("console.log('fixture')");
  expect(await readFile(new URL("_headers", destination), "utf8")).toBe(
    await readFile(new URL("../public/_headers", import.meta.url), "utf8"),
  );
  await expect(readFile(new URL("_headers", source), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});

async function assembledFiles(root: URL, prefix = ""): Promise<string[]> {
  const entries = await readdir(new URL(prefix, root), { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? assembledFiles(root, `${prefix}${entry.name}/`) : Promise.resolve([`${prefix}${entry.name}`])));
  return nested.flat().sort();
}

describe("static API reference", () => {
  const reference = (path: string) => readFile(new URL(`../api-reference/${path}`, import.meta.url), "utf8");

  it("assembles the reference page, its scripts, the Scalar bundle and licence, and the committed contract", async () => {
    const { source, destination } = await fixture();
    await mkdir(new URL("assets/", source), { recursive: true });
    await writeFile(new URL("index.html", source), "<html>built SPA</html>");
    await writeFile(new URL("assets/app.hash.js", source), "console.log('fixture')");
    await assembleAssets(source, destination);
    expect(await assembledFiles(destination)).toEqual([
      "_headers", "assets/app.hash.js", "index.html", "openapi/v1.json",
      "scalar/LICENSE.txt", "scalar/before.js", "scalar/config.js", "scalar/standalone.js", "scalar/v1.html",
    ]);
    for (const [path, from] of Object.entries(REFERENCE_FILES)) {
      expect((await readFile(new URL(path, destination))).equals(await readFile(from)), path).toBe(true);
    }
    expect(fileURLToPath(REFERENCE_FILES["openapi/v1.json"])).toMatch(/contracts\/openapi\/v1\.json$/);
    expect(fileURLToPath(REFERENCE_FILES["scalar/standalone.js"])).toMatch(/node_modules\/@scalar\/api-reference\/dist\/browser\/standalone\.js$/);
    expect(JSON.parse(await readFile(new URL("openapi/v1.json", destination), "utf8"))).toMatchObject({ openapi: expect.stringMatching(/^3\./) });
  });

  it("pins the Scalar bundle to one exact, installed and locked version", async () => {
    const edgePackage = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    const pinned: string = edgePackage.devDependencies["@scalar/api-reference"];
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    const installed = JSON.parse(await readFile(new URL("../node_modules/@scalar/api-reference/package.json", import.meta.url), "utf8"));
    expect(installed).toMatchObject({ version: pinned, license: "MIT" });
    const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
    expect(lock.packages["node_modules/@scalar/api-reference"]).toMatchObject({ version: pinned, integrity: expect.stringMatching(/^sha512-/) });
  });

  it("loads only same-origin script files, with no inline script, and avoids Scalar's id-based auto-mount", async () => {
    const page = await reference("v1.html");
    const scripts = [...page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts.map(([, attributes]) => attributes!.match(/src="([^"]+)"/)?.[1]))
      .toEqual(["/scalar/before.js", "/scalar/standalone.js", "/scalar/config.js"]);
    expect(scripts.every(([, , body]) => body!.trim() === "")).toBe(true);
    expect(page).not.toMatch(/https?:\/\//);
    expect(page).not.toMatch(/id="api-reference"/);
    expect(page).toContain('id="keyloop-api-reference"');
  });

  it("configures Scalar to reach no other origin, to link to no hosted client and to need no unsafe-eval", async () => {
    const config = await reference("config.js");
    for (const setting of ['url: "/openapi/v1.json"', "withDefaultFonts: false", "telemetry: false", 'showDeveloperTools: "never"',
      "agent: { disabled: true }", "mcp: { disabled: true }", "hideClientButton: true", "servers: [{ url: window.location.origin"]) {
      expect(config).toContain(setting);
    }
    expect(config).toContain('Scalar.createApiReference("#keyloop-api-reference"');
    expect(config).not.toMatch(/proxyUrl|pluginUrls|https?:\/\//);
    expect(await reference("before.js")).toContain("globalThis.__zod_globalConfig = { jitless: true }");
    expect(await reference("SCALAR-LICENSE.txt")).toContain("Copyright (c) 2023-present Scalar");
  });
});
