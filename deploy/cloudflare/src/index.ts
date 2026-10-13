import { Container } from "@cloudflare/containers";
import { fetchWithAvailability } from "./availability.ts";
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

  // A Durable Object can survive a settings-only deploy. Check once per Worker version as well as per instance/start;
  // the platform can restart the container with its earlier start options, so health alone does not prove configuration.
  private startConfigCurrent = false;
  private checkedVersionId: string | undefined;
  private reconciling: Promise<void> | undefined;
  private activeHttpRequests = 0;

  override async fetch(request: Request): Promise<Response> {
    // F5: once checked, a healthy container serves requests without reading Secrets Store. Every other request, including
    // one that arrives while another request's check, restart or cold start is still in progress, waits on that same
    // attempt with its 60 s readiness window before reaching the native port fetch (F11).
    const versionId = this.env.CF_VERSION_METADATA.id;
    if (!this.startConfigCurrent || this.checkedVersionId !== versionId || !(await this.runningAndHealthy())) {
      this.reconciling ??= this.reconcile(versionId).finally(() => { this.reconciling = undefined; });
      await this.reconciling;
    }
    // The SDK's containerFetch catches port errors, logs their raw text and returns a text 500. Fetch at the native
    // transport boundary instead, so a rejected fetch can be distinguished from every API-produced HTTP response.
    return fetchWithAvailability(request, () => this.proxyHttp(request));
  }

  private async proxyHttp(request: Request): Promise<Response> {
    this.activeHttpRequests++;
    this.renewActivityTimeout();
    const finished = () => {
      this.activeHttpRequests--;
      this.renewActivityTimeout();
    };
    try {
      const response = await this.ctx.container!.getTcpPort(API_PORT).fetch(request.url.replace(/^https:/, "http:"), request);
      if (response.body === null) {
        finished();
        return response;
      }
      // Keep the container awake until the response finishes, including a slow client or streaming response.
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      this.ctx.waitUntil(response.body.pipeTo(writable).catch(() => {}).finally(finished));
      return new Response(readable, response);
    } catch (error) {
      finished();
      throw error;
    }
  }

  override async onActivityExpired(): Promise<void> {
    if (this.activeHttpRequests > 0) this.renewActivityTimeout();
    else await super.onActivityExpired();
  }

  private async reconcile(versionId: string): Promise<void> {
    const healthy = await this.runningAndHealthy();
    let envVars: Record<string, string>;
    try {
      envVars = await containerEnv(this.env);
    } catch (error) {
      // A container that is not running is never started without its configuration. Health is read again because the
      // container can stop while Secrets Store is slow to fail. Refuse forwarding in that case; the Worker supplies the
      // availability fallback, and the next attempt checks again before any start.
      if (!healthy || !(await this.runningAndHealthy())) throw error;
      // The running container keeps serving with the configuration it was started with; the next request checks again.
      console.error(JSON.stringify({ event: "ApiContainerConfigUnverified" }));
      return;
    }
    const fingerprint = startFingerprint({ image: this.env.API_IMAGE, enableInternet: this.enableInternet, env: envVars });
    // Keep the SDK's start defaults consistent with the recorded fingerprint, including any SDK-initiated restart.
    this.envVars = envVars;
    if (this.ctx.container?.running) {
      const recorded = await this.ctx.storage.get<string>(START_FINGERPRINT_KEY);
      if (recorded === fingerprint && healthy) {
        this.startConfigCurrent = true;
        this.checkedVersionId = versionId;
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
    this.checkedVersionId = versionId;
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
