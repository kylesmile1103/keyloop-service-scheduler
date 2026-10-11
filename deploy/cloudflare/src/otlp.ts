import { BodyLimitError, jsonError, mediaType, readLimitedBody } from "./http";
import { requiredSecret } from "./secrets";

export const MAX_OTLP_BYTES = 256 * 1024;
type OtlpEnv = Pick<Env, "OTLP_RELAY_ENABLED" | "GRAFANA_OTLP_ENDPOINT" | "GRAFANA_OTLP_BASIC_BROWSER" | "OTLP_RELAY_LIMITER">;

export async function relayBrowserTraces(request: Request, env: OtlpEnv): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return jsonError("E_CROSS_SITE", 403);
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) return jsonError("E_CROSS_SITE", 403);
  const type = mediaType(request);
  if (type !== "application/x-protobuf" && type !== "application/json") return jsonError("E_CONTENT_TYPE", 415);
  // Refuse compression so the cap also bounds decompressed collector input.
  if (request.headers.has("content-encoding")) return jsonError("E_CONTENT_ENCODING", 415);
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) return jsonError("E_CLIENT_IP_MISSING", 400);
  try {
    const { success } = await env.OTLP_RELAY_LIMITER.limit({ key: ip });
    if (!success) return new Response(null, { status: 429, headers: { "retry-after": "60", "cache-control": "no-store" } });
    if (env.OTLP_RELAY_ENABLED !== "true") return jsonError("E_OTLP_DISABLED", 503);
    const body = await readLimitedBody(request, MAX_OTLP_BYTES);
    if (body.byteLength === 0) return jsonError("E_BODY_SIZE", 413);
    const endpoint = new URL(env.GRAFANA_OTLP_ENDPOINT);
    if (endpoint.protocol !== "https:" || !/^otlp-gateway-[a-z0-9-]+\.grafana\.net$/.test(endpoint.hostname) ||
        endpoint.pathname !== "/otlp" || endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      return jsonError("E_OTLP_CONFIG", 503);
    }
    const basic = await requiredSecret(env.GRAFANA_OTLP_BASIC_BROWSER, "grafana-otlp-basic-browser");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(basic)) return jsonError("E_OTLP_CONFIG", 503);
    const upstream = await fetch(`${endpoint.href}/v1/traces`, {
      method: "POST",
      headers: { "content-type": type, authorization: `Basic ${basic}` },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    await upstream.body?.cancel();
    // No upstream error text, cookies, redirects, or credentials reach the browser.
    return new Response(null, {
      status: upstream.status >= 300 && upstream.status < 400 ? 502 : upstream.status,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    return jsonError(error instanceof BodyLimitError ? "E_BODY_SIZE" : "E_OTLP_UNAVAILABLE", error instanceof BodyLimitError ? 413 : 503);
  }
}
