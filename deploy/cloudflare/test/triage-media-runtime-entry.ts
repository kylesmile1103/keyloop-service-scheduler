import { expireTriageMedia, handleTriageMedia } from "../src/triage-media.ts";

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/expire") { await expireTriageMedia(env); return new Response(null, { status: 204 }); }
    url.hostname = "triage-media.internal";
    return handleTriageMedia(new Request(url, request), env);
  },
} satisfies ExportedHandler<Env>;
