import { cp, mkdir, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function assembleAssets(source = new URL("../../../src/Keyloop.ServiceScheduler.Web/dist/", import.meta.url),
  destination = new URL("../build/assets/", import.meta.url)) {
  const index = new URL("index.html", source);
  try {
    if (!(await stat(index)).isFile()) throw new Error("Missing index");
  } catch {
    throw new Error("Build src/Keyloop.ServiceScheduler.Web first: dist/index.html is required");
  }
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true });
  await cp(new URL("../public/_headers", import.meta.url), new URL("_headers", destination));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await assembleAssets();
  console.log("SPA assets assembled into deploy/cloudflare/build/assets");
}
