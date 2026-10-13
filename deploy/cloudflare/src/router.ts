import { jsonError } from "./http.ts";
import { fetchWithAvailability } from "./availability.ts";
import { relayBrowserTraces } from "./otlp.ts";

export const API_INSTANCE_NAME = "api";

export async function routeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/otlp/v1/traces") return relayBrowserTraces(request, env);
  if (url.pathname === "/otlp" || url.pathname.startsWith("/otlp/")) return jsonError("E_NOT_FOUND", 404);
  if (url.pathname !== "/api" && !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/auth/")) return env.ASSETS.fetch(request);
  const readiness = url.pathname === "/api/ready";
  if (readiness && request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD", "cache-control": "no-store" } });
  }
  const headers = new Headers(request.headers);
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip || ip.includes(",") || /\s/.test(ip)) return jsonError("E_CLIENT_IP_MISSING", 400);
  // ADR-024: the edge is the sole ingress and replaces all client forwarding hints.
  headers.set("x-forwarded-for", ip);
  headers.set("x-forwarded-proto", url.protocol.slice(0, -1));
  headers.delete("forwarded");
  headers.delete("x-forwarded-host");
  // The API's existing /health checks connectivity and pending migrations. Never expose its body or headers.
  // Readiness is anonymous, has no caller-selected upstream path/query and retains the API's global rate limit.
  const upstream = readiness ? new Request(new URL("/health", url), { method: "GET", headers, signal: request.signal })
    : new Request(request, { headers });
  const response = await fetchWithAvailability(request, async () => {
    // F1: the first get must include this hint. A hint is best effort, not a residency guarantee.
    const api = env.API.get(env.API.idFromName(API_INSTANCE_NAME), { locationHint: "weur" });
    return await api.fetch(upstream);
  });
  if (!readiness) return response;
  await response.body?.cancel();
  return new Response(null, { status: response.status === 200 ? 200 : 503, headers: { "cache-control": "no-store" } });
}
