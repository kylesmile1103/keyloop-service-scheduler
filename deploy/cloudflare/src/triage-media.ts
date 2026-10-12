import { BodyLimitError, jsonError, mediaType, readLimitedBody } from "./http.ts";

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
type MediaEnv = Pick<Env, "TRIAGE_ENABLED" | "TRIAGE_IMAGES">;

export async function expireTriageMedia(env: MediaEnv): Promise<void> {
  if (env.TRIAGE_ENABLED !== "true" || !env.TRIAGE_IMAGES) return;
  let cursor: string | undefined;
  do {
    const page = await env.TRIAGE_IMAGES.list({ prefix: "triage/", limit: 500, include: ["customMetadata"], ...(cursor ? { cursor } : {}) });
    const now = Math.floor(Date.now() / 1000);
    const expired = page.objects.filter(object => !/^\d{10}$/.test(object.customMetadata?.expires ?? "") || Number(object.customMetadata?.expires) <= now);
    if (expired.length) await env.TRIAGE_IMAGES.delete(expired.map(object => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

// Called only by the Container outboundByHost hook. The public router has no route to this relay.
export async function handleTriageMedia(request: Request, env: MediaEnv): Promise<Response> {
  const url = new URL(request.url);
  if (env.TRIAGE_ENABLED !== "true" || !env.TRIAGE_IMAGES) return jsonError("E_IMAGES_DISABLED", 503);
  if (url.hostname !== "triage-media.internal" || url.search || !/^\/triage\/[0-9a-f]{32}\/[0-9a-f]{32}$/.test(url.pathname))
    return jsonError("E_MEDIA_PATH", 400);
  const key = url.pathname.slice(1);
  try {
    if (request.method === "PUT") {
      const type = mediaType(request);
      if (!["image/png", "image/jpeg", "image/webp"].includes(type)) return jsonError("E_MEDIA_TYPE", 400);
      const expiry = request.headers.get("x-upload-expires") ?? "";
      const now = Math.floor(Date.now() / 1000);
      if (!/^\d{10}$/.test(expiry) || Number(expiry) <= now || Number(expiry) > now + 3660)
        return jsonError("E_MEDIA_EXPIRY", 400);
      const bytes = await readLimitedBody(request, MAX_IMAGE_BYTES);
      if (bytes.length === 0) return jsonError("E_MEDIA_EMPTY", 400);
      await env.TRIAGE_IMAGES.put(key, bytes, {
        httpMetadata: { contentType: type, cacheControl: "no-store" },
        customMetadata: { expires: expiry },
      });
      return new Response(null, { status: 204 });
    }
    if (request.method === "GET") {
      const image = await env.TRIAGE_IMAGES.get(key);
      if (!image) return jsonError("E_MEDIA_MISSING", 404);
      const expires = image.customMetadata?.expires ?? "";
      if (!/^\d{10}$/.test(expires) || Number(expires) <= Math.floor(Date.now() / 1000)) {
        await image.body.cancel();
        await env.TRIAGE_IMAGES.delete(key);
        return jsonError("E_MEDIA_EXPIRED", 404);
      }
      if (image.size > MAX_IMAGE_BYTES || !["image/png", "image/jpeg", "image/webp"].includes(image.httpMetadata?.contentType ?? "")) {
        await image.body.cancel();
        return jsonError("E_MEDIA_INVALID", 503);
      }
      return new Response(image.body, { headers: {
        "content-type": image.httpMetadata!.contentType!, "content-length": String(image.size),
        "x-upload-expires": expires, "cache-control": "no-store", "x-content-type-options": "nosniff",
      } });
    }
    return jsonError("E_METHOD", 405);
  } catch (error) {
    return jsonError(error instanceof BodyLimitError ? "E_MEDIA_LIMIT" : "E_MEDIA_STORAGE", error instanceof BodyLimitError ? 413 : 503);
  }
}
