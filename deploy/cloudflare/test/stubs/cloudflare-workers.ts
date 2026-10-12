// Node stand-in for the workerd module. vitest.config.ts aliases `cloudflare:workers` here so the real
// @cloudflare/containers lifecycle code runs in unit tests; the platform base classes only keep ctx and env.
export class DurableObject<Env = unknown> {
  constructor(readonly ctx: unknown, readonly env: Env) {}
}

export class WorkerEntrypoint<Env = unknown> {
  constructor(readonly ctx: unknown, readonly env: Env) {}
}
