import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { assembleAssets } from "../scripts/assemble-assets.mjs";

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
