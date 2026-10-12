// A fake container runtime and Durable Object state for driving the real @cloudflare/containers class.
// The process "listens" readyAfterMs after start(); until then every port fetch fails the way workerd reports it.
interface StartConfig { env?: Record<string, string>; enableInternet: boolean }

export class FakeContainerRuntime {
  running = false;
  readonly starts: StartConfig[] = [];
  readonly proxied: Request[] = [];
  readonly intercepted: string[] = [];
  readonly signals: number[] = [];
  destroys = 0;
  /** Time the process takes to exit after SIGTERM, as Kestrel drains. */
  stopAfterMs = 0;
  /** A process that never handles SIGTERM, so only a kill stops it. */
  ignoresSigterm = false;
  private readyAt = Number.POSITIVE_INFINITY;
  private exits: (() => void)[] = [];

  constructor(public readyAfterMs: number) {}

  start(config: StartConfig): void {
    if (this.running) throw new Error("start() cannot be called on a container that is already running.");
    this.running = true;
    this.starts.push(config);
    this.readyAt = Date.now() + this.readyAfterMs;
  }

  monitor(): Promise<void> {
    return new Promise(resolve => { this.exits.push(resolve); });
  }

  /** The process exits with code 0, as after a sleep or a host restart. */
  exit(): void {
    this.running = false;
    this.readyAt = Number.POSITIVE_INFINITY;
    this.exits.splice(0).forEach(resolve => resolve());
  }

  signal(signo: number): void {
    this.signals.push(signo);
    if (this.ignoresSigterm && signo === 15) return;
    if (this.stopAfterMs > 0) setTimeout(() => this.exit(), this.stopAfterMs);
    else this.exit();
  }

  async destroy(): Promise<void> {
    this.destroys++;
    this.exit();
  }

  getTcpPort(port: number) {
    return {
      fetch: async (input: string | Request, init?: RequestInit) => {
        if (!this.running || Date.now() < this.readyAt) throw new Error(`The container is not listening on port ${port}`);
        const request = new Request(input, init);
        if (!["containerstarthealthcheck", "localhost"].includes(new URL(request.url).hostname)) this.proxied.push(request);
        // workerd responses carry webSocket; a body-less response keeps the library off workerd-only stream types.
        return Object.assign(new Response(null, { status: 204, headers: { "x-fake-api": "true" } }), { webSocket: null });
      },
    };
  }

  async interceptOutboundHttp(host: string): Promise<void> {
    this.intercepted.push(host);
  }

  async interceptAllOutboundHttp(): Promise<void> {
    this.intercepted.push("*");
  }
}

/** Durable Object storage survives a deploy; pass the same map to a new instance to model one. */
export function fakeContainerState(runtime: FakeContainerRuntime, values = new Map<string, unknown>()) {
  const kv = new Map<string, unknown>();
  return {
    id: { toString: () => "fake-api-object" },
    container: runtime,
    exports: { ContainerProxy: () => ({ fetch: async () => new Response(null, { status: 520 }) }) },
    blockConcurrencyWhile: <T>(callback: () => Promise<T>) => callback(),
    storage: {
      get: async (key: string) => values.get(key),
      put: async (key: string, value: unknown) => { values.set(key, value); },
      kv: { get: (key: string) => kv.get(key), put: (key: string, value: unknown) => { kv.set(key, value); } },
      sql: { exec: () => [] },
      setAlarm: async () => {},
      getAlarm: async () => null,
      deleteAlarm: async () => {},
      sync: async () => {},
    },
  } as unknown as DurableObjectState<{}>;
}

/** Settles a promise into a value so a rejection observed later is never reported as unhandled. */
export function settle<T>(promise: Promise<T>): Promise<{ value: T } | { error: unknown }> {
  return promise.then(value => ({ value }), (error: unknown) => ({ error }));
}
