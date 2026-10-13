import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const edge = new URL("../", import.meta.url);
const scalarPackage = new URL("node_modules/@scalar/api-reference/", edge);

// Static API reference asset mappings served at /scalar/v1 and /openapi/v1.json.
export const REFERENCE_FILES = {
  "scalar/v1.html": new URL("api-reference/v1.html", edge),
  "scalar/before.js": new URL("api-reference/before.js", edge),
  "scalar/config.js": new URL("api-reference/config.js", edge),
  "scalar/standalone.js": new URL("dist/browser/standalone.js", scalarPackage),
  "scalar/LICENSE.txt": new URL("api-reference/SCALAR-LICENSE.txt", edge),
  "openapi/v1.json": new URL("../../contracts/openapi/v1.json", edge),
};

async function requireFile(url, message) {
  try {
    if (!(await stat(url)).isFile()) throw new Error("Not a file");
  } catch {
    throw new Error(message);
  }
}

// The pinned package, not whatever an older install left behind, provides the bundle.
async function checkScalarBundle() {
  const pinned = JSON.parse(await readFile(new URL("package.json", edge), "utf8")).devDependencies["@scalar/api-reference"];
  let installed;
  try {
    installed = JSON.parse(await readFile(new URL("package.json", scalarPackage), "utf8")).version;
  } catch {
    installed = undefined;
  }
  if (installed !== pinned) {
    throw new Error(`@scalar/api-reference ${pinned} is pinned but ${installed ?? "nothing"} is installed: run npm ci in deploy/cloudflare`);
  }
  await requireFile(REFERENCE_FILES["scalar/standalone.js"], "The @scalar/api-reference standalone bundle is missing: run npm ci in deploy/cloudflare");
}

export async function assembleAssets(source = new URL("../../../src/Keyloop.ServiceScheduler.Web/dist/", import.meta.url),
  destination = new URL("../build/assets/", import.meta.url)) {
  await requireFile(new URL("index.html", source), "Build src/Keyloop.ServiceScheduler.Web first: dist/index.html is required");
  await checkScalarBundle();
  for (const [path, from] of Object.entries(REFERENCE_FILES)) await requireFile(from, `Missing ${fileURLToPath(from)} for ${path}`);
  // Everything is checked first, so a failure leaves the previous assembly in place.
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true });
  for (const [path, from] of Object.entries(REFERENCE_FILES)) {
    const to = new URL(path, destination);
    await mkdir(new URL("./", to), { recursive: true });
    await cp(from, to);
  }
  await cp(new URL("../public/_headers", import.meta.url), new URL("_headers", destination));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await assembleAssets();
  console.log("SPA assets and the static API reference assembled into deploy/cloudflare/build/assets");
}
