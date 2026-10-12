import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare, Response as MiniflareResponse } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleTriageMedia, MAX_IMAGE_BYTES } from "../src/triage-media.ts";
import { fakeEnv } from "./helpers.ts";

let mf: Miniflare;
const key = `triage/${"a".repeat(32)}/${"b".repeat(32)}`;
const url = `https://media.test/${key}`;
const bytes = new Uint8Array([137, 80, 78, 71]);
const expiry = () => String(Math.floor(Date.now() / 1000) + 3600);

beforeAll(async () => {
  const bundle = await build({ entryPoints: [new URL("./triage-media-runtime-entry.ts", import.meta.url).pathname], bundle: true,
    write: false, format: "esm", platform: "browser" });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0]!.text,
    compatibilityDate: "2026-10-11", compatibilityFlags: ["nodejs_compat"], cf: false,
    unsafeDevRegistryPath: new URL("../build/media-dev-registry/", import.meta.url).pathname,
    bindings: { TRIAGE_ENABLED: "true" }, r2Buckets: ["TRIAGE_IMAGES"],
    outboundService: () => new MiniflareResponse("Network forbidden", { status: 503 }),
  }));
  await mf.ready;
}, 30_000);
afterAll(async () => { await mf?.dispose(); });

const put = (body: Uint8Array<ArrayBuffer> = bytes, headers: Record<string, string> = {}) => mf.dispatchFetch(url, {
  method: "PUT", body, headers: { "content-type": "image/png", "x-upload-expires": expiry(), ...headers },
});

describe("private R2 image relay", () => {
  it("stores and returns exact bytes and expiry without public caching", async () => {
    expect((await put()).status).toBe(204);
    const response = await mf.dispatchFetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Number(response.headers.get("x-upload-expires"))).toBeGreaterThan(Date.now() / 1000);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });
  it("refuses expired objects and deletes them", async () => {
    const bucket = await mf.getR2Bucket("TRIAGE_IMAGES");
    await bucket.put(key, bytes, { httpMetadata: { contentType: "image/png" }, customMetadata: { expires: "1000000000" } });
    expect((await mf.dispatchFetch(url)).status).toBe(404);
    expect(await bucket.head(key)).toBeNull();
  });
  it("sweeps expired abandoned uploads while retaining current uploads", async () => {
    const bucket = await mf.getR2Bucket("TRIAGE_IMAGES");
    await bucket.put(`${key}-old`, bytes, { customMetadata: { expires: "1000000000" } });
    await put();
    expect((await mf.dispatchFetch("https://media.test/expire")).status).toBe(204);
    expect(await bucket.head(`${key}-old`)).toBeNull();
    expect(await bucket.head(key)).not.toBeNull();
  });
  it("bounds actual bytes and rejects unsupported types and unbounded retention", async () => {
    // Exercise the actual request stream directly: Node can reset a TCP upload when a Worker rejects an unread body.
    const { env } = fakeEnv();
    env.TRIAGE_ENABLED = "true";
    const oversized = new Request(`http://triage-media.internal/${key}`, { method: "PUT", body: new Uint8Array(MAX_IMAGE_BYTES + 1),
      headers: { "content-type": "image/png", "x-upload-expires": expiry() } });
    expect((await handleTriageMedia(oversized, env)).status).toBe(413);
    expect(env.TRIAGE_IMAGES.put).not.toHaveBeenCalled();
    expect((await put(bytes, { "content-type": "application/pdf" })).status).toBe(400);
    expect((await put(bytes, { "x-upload-expires": "9999999999" })).status).toBe(400);
  });
  it("refuses traversal, external hosts and disabled image triage", async () => {
    const { env } = fakeEnv();
    expect((await handleTriageMedia(new Request(`http://triage-media.internal/${key}`), env)).status).toBe(503);
    env.TRIAGE_ENABLED = "true";
    expect((await handleTriageMedia(new Request(`http://public.test/${key}`), env)).status).toBe(400);
    expect((await handleTriageMedia(new Request("http://triage-media.internal/triage/other/key"), env)).status).toBe(400);
    expect(env.TRIAGE_IMAGES.get).not.toHaveBeenCalled();
  });
});
