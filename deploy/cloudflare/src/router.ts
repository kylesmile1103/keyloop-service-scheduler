import { jsonError } from "./http";
import { relayBrowserTraces } from "./otlp";

export const API_INSTANCE_NAME = "api";

export async function routeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/otlp/v1/traces") return relayBrowserTraces(request, env);
  if (url.pathname === "/otlp" || url.pathname.startsWith("/otlp/")) return jsonError("E_NOT_FOUND", 404);
  if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
  const headers = new Headers(request.headers);
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip || ip.includes(",") || /\s/.test(ip)) return jsonError("E_CLIENT_IP_MISSING", 400);
  // ADR-024: the edge is the sole ingress and replaces all client forwarding hints.
  headers.set("x-forwarded-for", ip);
  headers.set("x-forwarded-proto", url.protocol.slice(0, -1));
  headers.delete("forwarded");
  headers.delete("x-forwarded-host");
  try {
    // F1: the first get must include this hint. A hint is best effort, not a residency guarantee.
    const api = env.API.get(env.API.idFromName(API_INSTANCE_NAME), { locationHint: "weur" });
    return await api.fetch(new Request(request, { headers }));
  } catch {
    console.error(JSON.stringify({ event: "ApiUnavailable" }));
    return jsonError("E_API_UNAVAILABLE", 503);
  }
}
