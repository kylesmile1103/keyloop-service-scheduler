import { Container } from "@cloudflare/containers";
import { containerEnv, startFingerprint } from "./container-env.ts";
import { handleEmailRelay } from "./email/relay.ts";
import { routeRequest } from "./router.ts";
import { expireTriageMedia, handleTriageMedia } from "./triage-media.ts";

export { ContainerProxy } from "@cloudflare/containers";

const API_PORT = 8080;
const READY_TIMEOUT_MS = 60_000;
// Durable Object storage key for the SHA-256 digest of the configuration the running container was started with.
export const START_FINGERPRINT_KEY = "keyloop:api-start-fingerprint";
// SIGTERM lets Kestrel drain; a container still running after the grace period is killed, so a restart stays bounded.
export const STOP_GRACE_MS = 15_000;
const KILL_WAIT_MS = 5_000;
const STOP_POLL_MS = 250;

export class ApiContainer extends Container<Env> {
  override defaultPort = API_PORT;
  override sleepAfter = "30m";
  override enableInternet = true;
  override pingEndpoint = "localhost/alive";

  // Whether this Durable Object instance has confirmed that the running container was started with the configuration it
  // would pass now. Every deploy, including one that only changes settings, the image or nothing at all, replaces the
  // instance, so each deploy checks once; a container the platform restarted on its own keeps its earlier start options.
  private startConfigCurrent = false;
  private reconciling: Promise<void> | undefined;

  override async fetch(request: Request): Promise<Response> {
    // F5: once checked, a healthy container serves requests without reading Secrets Store. Every other request, including
    // one that arrives while another request's check, restart or cold start is still in progress, waits on that same
    // attempt with its 60 s readiness window. Otherwise containerFetch would wait with the library's 20 s default and
    // answer a raw 500 during a slower cold start (F11).
    if (!this.startConfigCurrent || !(await this.runningAndHealthy())) {
      this.reconciling ??= this.reconcile().finally(() => { this.reconciling = undefined; });
      await this.reconciling;
    }
    return this.containerFetch(request, API_PORT);
  }

  private async reconcile(): Promise<void> {
    const healthy = await this.runningAndHealthy();
    let envVars: Record<string, string>;
    try {
      envVars = await containerEnv(this.env);
    } catch (error) {
      // A container that is not running is never started without its configuration. Health is read again because the
      // container can stop while Secrets Store is slow to fail; containerFetch would then start it with whatever this.envVars
      // holds, an empty environment on a fresh instance. The request gets the Worker's JSON 503 and the next request checks again.
      if (!healthy || !(await this.runningAndHealthy())) throw error;
      // The running container keeps serving with the configuration it was started with; the next request checks again.
      console.error(JSON.stringify({ event: "ApiContainerConfigUnverified" }));
      return;
    }
    const fingerprint = startFingerprint({ image: this.env.API_IMAGE, enableInternet: this.enableInternet, env: envVars });
    // containerFetch can still start a container that stops after this check; it then uses this.envVars, which always
    // matches the recorded fingerprint.
    this.envVars = envVars;
    if (this.ctx.container?.running) {
      const recorded = await this.ctx.storage.get<string>(START_FINGERPRINT_KEY);
      if (recorded === fingerprint && healthy) {
        this.startConfigCurrent = true;
        return;
      }
      if (recorded !== fingerprint) {
        // Never logs the values or the digest: the reason is enough to correlate a deploy with the restart.
        console.log(JSON.stringify({ event: "ApiContainerRestart", reason: recorded === undefined ? "unrecorded" : "configuration-changed" }));
        await this.stopForRestart();
      }
    }
    if (!this.ctx.container?.running) await this.ctx.storage.put(START_FINGERPRINT_KEY, fingerprint);
    await this.startAndWaitForPorts({
      ports: [API_PORT],
      startOptions: { envVars },
      cancellationOptions: { portReadyTimeoutMS: READY_TIMEOUT_MS },
    });
    this.startConfigCurrent = true;
  }

  private async runningAndHealthy(): Promise<boolean> {
    return this.ctx.container?.running === true && (await this.getState()).status === "healthy";
  }

  private async stopForRestart(): Promise<void> {
    await this.stop("SIGTERM");
    if (await this.exitedWithin(STOP_GRACE_MS)) return;
    console.error(JSON.stringify({ event: "ApiContainerStopTimeout" }));
    await this.destroy();
    if (await this.exitedWithin(KILL_WAIT_MS)) return;
    throw new Error("The API container did not stop for a configuration restart");
  }

  private async exitedWithin(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.ctx.container?.running) {
      if (Date.now() >= deadline) return false;
      await new Promise(resolve => setTimeout(resolve, STOP_POLL_MS));
    }
    return true;
  }
}

ApiContainer.outboundByHost = {
  "email.internal": (request, env: Env) => handleEmailRelay(request, env),
  "triage-media.internal": (request, env: Env) => handleTriageMedia(request, env),
};

export default {
  fetch: routeRequest,
  async scheduled(_event, env) { await expireTriageMedia(env); },
} satisfies ExportedHandler<Env>;
