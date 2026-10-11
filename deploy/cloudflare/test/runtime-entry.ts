import { DurableObject } from "cloudflare:workers";
import { routeRequest } from "../src/router";

// Real edge router and asset pipeline, with a local DO instead of a Linux container.
export class FakeApi extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
    return Response.json({
      api: true, path: new URL(request.url).pathname,
      forwardedFor: request.headers.get("x-forwarded-for"),
      forwardedProto: request.headers.get("x-forwarded-proto"),
    }, { headers: { "cache-control": "no-store" } });
  }
}
export default { fetch: routeRequest } satisfies ExportedHandler<Env>;
