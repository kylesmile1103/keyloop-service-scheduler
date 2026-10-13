import { startFingerprint } from "../src/container-env.ts";

// Hashes in workerd itself, so the node:crypto import the Durable Object relies on is proven under nodejs_compat.
export default {
  async fetch(request: Request) {
    return new Response(startFingerprint(await request.json()));
  },
} satisfies ExportedHandler<Env>;
