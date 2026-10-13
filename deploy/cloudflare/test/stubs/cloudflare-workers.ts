// Node test stub for `cloudflare:workers` used by Vitest.
export class DurableObject<Env = unknown> {
  constructor(readonly ctx: unknown, readonly env: Env) {}
}

export class WorkerEntrypoint<Env = unknown> {
  constructor(readonly ctx: unknown, readonly env: Env) {}
}
