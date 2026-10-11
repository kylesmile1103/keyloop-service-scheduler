import { Container } from "@cloudflare/containers";
import { containerEnv } from "./container-env";
import { handleEmailRelay } from "./email/relay";
import { routeRequest } from "./router";

export { ContainerProxy } from "@cloudflare/containers";

export class ApiContainer extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = "30m";
  override enableInternet = true;
  override pingEndpoint = "localhost/alive";

  override async fetch(request: Request): Promise<Response> {
    // F5: running requests never depend on Secrets Store availability or latency.
    if (!this.ctx.container?.running) {
      await this.startAndWaitForPorts({
        ports: [8080],
        startOptions: { envVars: await containerEnv(this.env) },
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
