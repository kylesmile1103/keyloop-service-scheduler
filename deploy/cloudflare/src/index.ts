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

  // Reconcile once per Worker version and container start so settings-only deploys take effect.
  private startConfigCurrent = false;
  private checkedVersionId: string | undefined;
  private reconciling: Promise<void> | undefined;
  private activeHttpRequests = 0;

  override async fetch(request: Request): Promise<Response> {
    // Share a single in-flight reconciliation across concurrent requests before reading from the container port.
    const versionId = this.env.CF_VERSION_METADATA.id;
    if (!this.startConfigCurrent || this.checkedVersionId !== versionId || !(await this.runningAndHealthy())) {
      this.reconciling ??= this.reconcile(versionId).finally(() => { this.reconciling = undefined; });
      await this.reconciling;
    }
    // Proxy directly via the native TCP port so transport failures can be distinguished from API HTTP responses.
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
      // Never start a stopped container without verified configuration; allow an already-healthy container to keep serving.
      if (!healthy || !(await this.runningAndHealthy())) throw error;
      console.error(JSON.stringify({ event: "ApiContainerConfigUnverified" }));
      return;
    }
    const fingerprint = startFingerprint({ image: this.env.API_IMAGE, enableInternet: this.enableInternet, env: envVars });
    this.envVars = envVars;
    if (this.ctx.container?.running) {
      const recorded = await this.ctx.storage.get<string>(START_FINGERPRINT_KEY);
      if (recorded === fingerprint && healthy) {
        this.startConfigCurrent = true;
        this.checkedVersionId = versionId;
        return;
      }
      if (recorded !== fingerprint) {
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
