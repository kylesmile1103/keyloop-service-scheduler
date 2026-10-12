import { Container } from "@cloudflare/containers";
import { containerEnv } from "./container-env.ts";
import { handleEmailRelay } from "./email/relay.ts";
import { routeRequest } from "./router.ts";

export { ContainerProxy } from "@cloudflare/containers";

export class ApiContainer extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = "30m";
  override enableInternet = true;
  override pingEndpoint = "localhost/alive";

  override async fetch(request: Request): Promise<Response> {
    // F5: a healthy container serves requests without reading Secrets Store. Every other request, including one that
    // arrives while another request's start still waits for Kestrel, takes this configured path. Otherwise
    // containerFetch would wait with the library's 20 s default and answer a raw 500 during a slower cold start (F11).
    // The library coalesces concurrent starts, so the container still starts once.
    if (!this.ctx.container?.running || (await this.getState()).status !== "healthy") {
      // containerFetch can still start a container that stops after this check; it then uses this.envVars.
      this.envVars = await containerEnv(this.env);
      await this.startAndWaitForPorts({
        ports: [8080],
        startOptions: { envVars: this.envVars },
        cancellationOptions: { portReadyTimeoutMS: 60_000 },
      });
    }
    return this.containerFetch(request, 8080);
  }
}

ApiContainer.outboundByHost = {
  "email.internal": (request, env: Env) => handleEmailRelay(request, env),
};

export default { fetch: routeRequest } satisfies ExportedHandler<Env>;
