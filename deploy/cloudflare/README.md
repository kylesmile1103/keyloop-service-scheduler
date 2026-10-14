# Keyloop Cloudflare edge

This project serves the scheduler SPA on `keyloop.kylesmile.me` and routes its API calls to a .NET Container that sleeps when idle.
It also owns the private email relay, an optional browser OTLP trace relay and the optional API telemetry export to Grafana Cloud.
Routine releases run from GitHub Actions after successful main CI, with reviewer approval of the `production` environment.
The laptop path in the runbook remains for bootstrap and break-glass.

## Deploy from GitHub Actions

[The runbook's Actions section](DEPLOY-RUNBOOK.md#deploy-from-github-actions) gives the job graph, repository setup, secret and variable inventory and token permissions. In short:

- `plan` builds and pushes the SHA-tagged API image and dry-runs the SPA and edge, in the main-only `plan` environment without reviewers.
- Optional manual `migrate` and `deploy` run in the protected `production` environment.
- `verify` polls the new image and runs public smoke checks within six minutes.
- `scripts/configure-github-environment.sh <owner>/<repo> <approver-github-login>` creates both environments, restricts them to `main`, and sets secrets through stdin. Only `production` holds `NEON_OWNER_CONNECTION`.
- Never upload `.cloudflare/output`, which contains the role lists; both build jobs delete it even after a failure.

## Local verification

Use Node 22.18 or later within Node 22 (`nvm install 22` if needed). Dependencies, including project-local `cf` and Wrangler, are pinned in `package-lock.json`. These commands need no Cloudflare account, database, Docker daemon, email destination or Grafana account:

```sh
cd deploy/cloudflare
source ~/.nvm/nvm.sh
nvm exec 22 npm ci --cache ./build/npm-cache --no-audit --no-fund
nvm exec 22 npm run typecheck
nvm exec 22 npm test
nvm exec 22 npm run validate:build
nvm exec 22 npm run validate:build:integrations
```

- `typecheck` generates Cloudflare runtime and binding types locally first.
- The two build validations run **only `cf build`**, with dummy identifiers, fixture assets, CLI telemetry off and CLI state in ignored directories. They check the emitted routing, bindings and container metadata, and that an invalid setting fails the build. The second includes the optional REST-email, browser-OTLP, API-telemetry and triage bindings.
- Vitest runs unit tests and real Static Assets routing in Miniflare, with global network fetches denied.
  Container lifecycle tests run the real `@cloudflare/containers` class against a fake runtime (`cloudflare:workers` is aliased to a stub in `vitest.config.ts`).
  They cover cold-start readiness, coalesced starts and the [configuration restarts](#configuration-changes-and-container-restarts), for both a new and a surviving Durable Object instance.
- Offline smoke assertions reject stale or mixed images, missing schema readiness, empty schedules and unmasked personal fields.
- The Miniflare test uses compatibility date `2026-10-11` because its runtime rejects the next UTC date on this machine; the deployment uses `2026-10-12`.

Production egress, placement, real cold-start time and binding access remain deployment checks.

## Assemble the real SPA

Build `src/Keyloop.ServiceScheduler.Web` first. Then `nvm exec 22 npm run assemble` copies its `dist/` into `build/assets/` and adds the [static API reference](#static-api-reference) and `public/_headers`. It refuses a missing `dist/index.html` or a Scalar install that differs from the pinned version.

`cloudflare.config.ts` is the deployment source of truth; `wrangler.config.ts` is the bundler configuration `cf` consumes. Do not add a competing `wrangler.jsonc`. `nvm exec 22 npm run build` builds the real assembly with the identifiers below set; it runs only `cf build` and consumes an existing API image reference.

## Configuration contract

Set these environment variables when evaluating `cloudflare.config.ts`.
They are identifiers and policy settings, never credentials.
Role lists contain personal data and are supplied privately, outside source control.
`src/settings.ts` validates them, so `cf build` fails on an unknown transport, REST without a 32-character hexadecimal account ID, an enabled relay or telemetry export without an endpoint, telemetry without a numeric instance ID, a switch other than `true` or `false`, or an allowlist or cap the container would refuse.

An empty value means the default.
Modules under `src/` import each other with explicit `.ts` specifiers, because `cf` evaluates the config with Node's type stripping.

| Variable | Default / meaning |
| --- | --- |
| `KEYLOOP_SECRETS_STORE_ID` | Required existing store ID |
| `KEYLOOP_API_IMAGE` | Required existing registry image reference, immutable SHA tag recommended. Also bound to the Worker as text `API_IMAGE`, so a new image restarts the container with the current configuration |
| `KEYLOOP_ACCESS_TEAM_DOMAIN` | Required canonical `https://<team>.cloudflareaccess.com` issuer |
| `KEYLOOP_ACCESS_AUDIENCE` | Required comma-separated application AUD tags, case preserved |
| `KEYLOOP_ACCESS_ADMIN` | Empty; comma-separated exact emails or `@domain` role members, supplied outside the repository |
| `KEYLOOP_ACCESS_SERVICE_ADVISOR` | Same, for booking/cancel/triage operators |
| `KEYLOOP_ACCESS_VIEWER` | Same, for authenticated full reads and appointment details |
| `KEYLOOP_NOTIFICATIONS_ENABLED` | `false`; passed to the API at container start. `false` selects the API provider `None`; `true` selects the reserved `Cloudflare` provider, which the API refuses at startup until `RelayEmailSender` exists |
| `KEYLOOP_EMAIL_SENDING_ENABLED` | `false`; independent Worker kill switch |
| `KEYLOOP_EMAIL_TRANSPORT` | `binding`, or explicit `rest` fallback |
| `KEYLOOP_EMAIL_ACCOUNT_ID` | Existing account ID, needed for REST only |
| `KEYLOOP_EMAIL_ALLOWED_ADDRESSES` | Empty; comma-separated approved bare mailboxes |
| `KEYLOOP_EMAIL_ALLOWED_DOMAINS` | Empty; comma-separated exact domains, no wildcard or subdomain expansion |
| `KEYLOOP_EMAIL_MAX_PER_RECIPIENT_PER_DAY` | `10`, valid range 1-1000, enforced by the .NET dispatcher |
| `KEYLOOP_EMAIL_MAX_PER_DAY` | `100`, valid range 1-10000; reduce below the actual account quota |
| `KEYLOOP_OTLP_RELAY_ENABLED` | `false`; binds the browser credential only when `true` |
| `KEYLOOP_GRAFANA_OTLP_ENDPOINT` | Empty; `https://otlp-gateway-<region>.grafana.net/otlp`, without a trailing slash. Shared by the browser relay and API telemetry; required by whichever is enabled |
| `KEYLOOP_API_OTLP_ENABLED` | `false`; `true` binds `keyloop_prod_api_otlp_token` and passes the API its OTLP settings at container start ([Optional API telemetry](#optional-api-telemetry)) |
| `KEYLOOP_GRAFANA_INSTANCE_ID` | Empty; the Grafana Cloud stack's numeric instance ID (digits only, the Basic-auth user), required when API telemetry is enabled |
| `KEYLOOP_VEHICLE_AWARE_REQUIREMENTS` | `false`; `true` passes `Scheduling__VehicleAwareRequirements=true` at container start, this deployment's explicit override of the API's Production default (`appsettings.Production.json` keeps `false`). `false` passes nothing. See [Vehicle-aware booking](#vehicle-aware-booking) |

### Secrets

| Secret | Bound when | Reaches |
| --- | --- | --- |
| `keyloop_prod_db_url` | Always | Container start environment. Direct (not `-pooler`) Neon TLS string for the runtime DML role in Npgsql keyword form, `Host=...;Port=5432;Database=...;Username=scheduler_app;Password=...;SSL Mode=VerifyFull;Channel Binding=Require`. The API refuses Neon's default `postgresql://` URI |
| `keyloop_prod_email_api_token` | REST email transport | Worker only |
| `grafana-otlp-basic-browser` | Browser relay enabled | Worker only; base64 of `instance-id:token` |
| `keyloop_prod_api_otlp_token` | API telemetry enabled | Container start environment; the Grafana token itself, not base64 |
| `keyloop_prod_ai_token` | Triage enabled | Container start environment |

Missing DB credentials stop startup with a sanitised error. The container receives its whole configuration, secrets included, only when it starts; see [Configuration changes](#configuration-changes-and-container-restarts).

### Email relay

- Only approved recipients receive mail. Reserved example, test, invalid and localhost domains are always refused, even if allowlisted.
- The sender is fixed to `notifications@keyloop.kylesmile.me`; no reply-to is accepted. `test/fixtures/email-relay-request.json` is the contract fixture for the .NET sender's parity test.
- 200 means the provider accepted the message, with `messageId` when known. An acceptance it cannot fully confirm is still 200 and logs `EmailAcceptedUnconfirmed` with the notification ID, because neither transport has an idempotency key and a retry could duplicate the email.
- 400 is a malformed request, 422 a permanent refusal, and 503 with `retryable=true` means not accepted or unknown, such as a timeout. There is no automatic fallback resend.

### Routing

- `/api`, `/api/*` and `/auth/*` reach the named `api` Durable Object with the `weur` hint. The Worker replaces client forwarding headers and passes the Access assertion and `CF_Authorization` cookie unchanged; the container validates the JWT and decides roles.
- Edge-only `GET`/`HEAD /api/ready` calls the API's `/health` and returns only a bodyless 200 or 503 with `Cache-Control: no-store`. Other methods return 405. The API checks database connectivity and pending migrations on each probe, under its global rate limit.
- `/otlp/v1/traces` accepts POST JSON or protobuf, with fetch-site and origin checks, a 256 KiB streamed cap and 120 requests/min per client. Other `/otlp` paths return JSON 404.
- Cloudflare serves `/cdn-cgi/access/logout` before Worker routing.
- Everything else is Static Assets: `/scalar/v1` (the [static API reference](#static-api-reference)), `/openapi/v1.json` (the committed contract), and the SPA fallback for every other path, `/health`, `/alive` and bare `/scalar` included. None of these reaches the API.
- `public/_headers` sends host-only HSTS (`max-age=31536000`, no `includeSubDomains` or `preload`) from the first deploy. Browsers record it only from a valid HTTPS response (RFC 6797 section 8.1), so it cannot take effect before the certificate works.

The trust contract and deployment profile are in [ARCHITECTURE](../../docs/ARCHITECTURE.md#114-cloudflare-edge-boundary-and-credentials).

## Static API reference

The board's sidebar links "API reference" to `/scalar/v1`. Locally, the Vite proxy sends it to the API, which maps Scalar and `/openapi/v1.json` outside Production (ADR-018). The deployed API runs as Production and maps neither, so the edge serves a static reference at the same paths:

- `api-reference/v1.html` becomes `/scalar/v1`; `/scalar/v1/` and `/scalar/v1.html` redirect to it.
- `/openapi/v1.json` is a copy of the committed `contracts/openapi/v1.json`, which `OpenApiContractTests` keeps equal to the runtime document. It holds routes, schemas and problem types, no servers, settings or secrets, and excludes the reseed route.
- The page uses Scalar's standalone bundle from `@scalar/api-reference` (MIT), pinned at `1.72.2` and copied unmodified by `npm run assemble`, with its licence at `/scalar/LICENSE.txt`. Nothing loads from a CDN. The bundle is about 1.26 MB gzipped.

It runs under the site CSP unchanged:

- No inline script: `scalar/before.js` and `scalar/config.js` are files, and `config.js` calls `Scalar.createApiReference`.
- `config.js` turns off Scalar's font CDN (`withDefaultFonts: false`), telemetry, the AI agent and MCP, and hides the developer toolbar and, with `hideClientButton: true`, the "Open API Client" button that would send the contract to `client.scalar.com`. Two off-site links remain, neither carrying API data: Scalar's credit, and MDN's page for a response status in "Test Request".
- The page mounts on `keyloop-api-reference`, because the bundle auto-mounts a default-configured reference on any element with the id `api-reference`.
- `before.js` sets Zod's `jitless` option (`globalThis.__zod_globalConfig`), so the bundle never runs the `Function("")` probe that `script-src 'self'` would report.

The contract declares no servers, so `config.js` sets this origin as the only one. "Test Request" and the curl examples target this site; writes need the Access session cookie from `/auth/login` in the same browser.

**Browser check.** The edge tests cover the assembly, the CSP, scripts, redirects and contract in Miniflare.
`scripts/check-api-reference.mjs` also loads `/scalar/v1` in headless Chromium in light, dark and phone layouts against a fake API.
It fails on a CSP violation, an off-origin request or link beyond the two above, a console error, an operation that did not render, or a "Test Request" that does not reach the site.
Rerun it before changing the pinned Scalar version:

```sh
PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core nvm exec 22 node scripts/check-api-reference.mjs [screenshot directory]
```

On 1.72.2 it passes with all 26 operations rendered. With `--scalar-defaults` it fails on 14 blocked font requests and the `eval` probe, and with `hideClientButton: false` it fails on the `client.scalar.com` links, which shows it detects both.

## Configuration changes and container restarts

A running container keeps the environment it was started with. A Worker deploy leaves it running, and a rollout to a new image restarts it with the old start options (observed live: after enabling triage and rolling out a new image, `Triage__Enabled` stayed `false`). The Durable Object therefore owns the restart.

How it works:

1. It records a SHA-256 fingerprint of each start configuration: image reference, internet access and every environment value, secrets included. Only the digest is stored.
2. On the first API request each instance handles, and again whenever the Worker version id from `CF_VERSION_METADATA` changes, it rebuilds the configuration it would use now (one Secrets Store read) and compares fingerprints.
3. If the running container's fingerprint differs or is missing, it sends SIGTERM, waits up to 15 s, kills the container if needed, waits up to 5 s more, then starts it with the new configuration and waits up to 60 s for it to listen. The Worker log records `ApiContainerRestart` (reason `configuration-changed` or `unrecorded`) and `ApiContainerStopTimeout` if a kill was needed.
4. If the old container is still running after the kill, the request gets the Worker's RFC 9457 `503 service-unavailable` (`Retry-After: 3`, `Cache-Control: no-store`) and the old fingerprint stays, so the next request retries. Concurrent requests wait on the same restart.
5. If Secrets Store cannot be read while the container is healthy, the running container serves the request, the log records `ApiContainerConfigUnverified`, and the next request checks again. A container that is not running is never started without its secrets; the request gets the same 503.

After a successful check, a healthy container serves requests without further Secrets Store reads. In practice:

- **Changed setting or new `KEYLOOP_API_IMAGE`:** rebuild and deploy; the first API request restarts the container.
- **Rotated secret** (`keyloop_prod_db_url`, `keyloop_prod_ai_token`, `keyloop_prod_api_otlp_token`): deploy again (the prebuilt output is enough); the first API request restarts the container. A container waking from sleep (`sleepAfter` 30 minutes) also picks up the current value.
- **Assets-only deploy:** the running container is kept.
- **Asleep container:** it cold-starts with the current configuration and no restart event is logged.

Rejected port fetches and Durable Object calls use the same 503 problem. Only GET and HEAD retry once, after 150 ms; writes never retry, and every API response, a 500 included, passes through unchanged. See the [unavailability runbook](DEPLOY-RUNBOOK.md#container-unavailability-during-a-rollout).

## Deployment runbook, REQUIRES USER CONFIRMATION

The source of truth is [ARCHITECTURE's Cloudflare deployment view](../../docs/ARCHITECTURE.md#101-cloudflare-deployment-profile) and [ADR-022..024](../../docs/ARCHITECTURE.md#18-architecture-decision-records).
Local verification performs no deployment, account change or real send.
The ordered commands are in [DEPLOY-RUNBOOK.md](DEPLOY-RUNBOOK.md), including [enabling API telemetry](DEPLOY-RUNBOOK.md#enable-api-telemetry).

1. **REQUIRES USER CONFIRMATION:** create the Neon Free PG17 project in Frankfurt (`eu-central-1`, the nearest region to WEUR), pin compute to 0.25 CU without autoscaling, apply the owner-role migration bundle, grant the runtime DML role and populate Secrets Store.
2. **REQUIRES USER CONFIRMATION:** prepare the sending subdomain, its six child DNS records and DMARC `p=reject`, disable Email preview, and enforce HTTPS on this hostname. Include the subdomain preview POST in the same confirmation.
3. Build the SPA and `linux/amd64` API image locally. **REQUIRES USER CONFIRMATION:** publish the image and apply the Worker, Container and Custom Domain configuration with `--provision=false`, after inspecting the dry run, with sending disabled. Confirm right afterwards that `http://keyloop.kylesmile.me/` redirects to HTTPS.
4. **REQUIRES USER CONFIRMATION:** choose reviewer addresses, read the account quota and set a lower daily cap. Before enabling public sending, test a controlled send to an approved mailbox that is **not** a verified destination. `E_RECIPIENT_NOT_ALLOWED` needs a transport review; REST HTTP 403 / code 10105 needs the account entitlement resolved. No transport switches automatically.
5. **REQUIRES USER CONFIRMATION:** enable integrations only after their gates pass.
   Verify deep links, API JSON, `/api/ready` 200, no public health details or reseed route, `/scalar/v1` and `/openapi/v1.json`, trusted client IP and HSTS, reserved-domain suppression, booking, cancellation and the 30-way result, direct Neon TCP 5432 access, and sleep and wake timing against the 60-second port-ready window.
   Use a new instance name if the Durable Object was created without the WEUR hint.

Notifications must stay disabled until the .NET side provides `RelayEmailSender`, recipient suppression and cap accounting, and stale-notification suppression after sleep.
Production-with-demo-data startup without a reseed key and forwarding middleware before rate limiting are in place: `CloudflareContainerEnvTests` boots the API with the Worker's core environment (`test/fixtures/container-env-core.json`, pinned by `test/container.test.ts`).
Neon Free compute exhaustion suspends service until the next period; its restore window is six hours.
Container log pricing changes on 2026-12-01.

## Optional API telemetry

With `KEYLOOP_API_OTLP_ENABLED=false` (the default), the container receives no OTLP setting and ServiceDefaults registers no exporter (`container-env-core.json` pins this).
Enabling it requires `KEYLOOP_GRAFANA_OTLP_ENDPOINT`, `KEYLOOP_GRAFANA_INSTANCE_ID` and the secret `keyloop_prod_api_otlp_token`, a Grafana Cloud token with `metrics:write`, `logs:write` and `traces:write` for this stack only.
At container start the Durable Object reads the token and passes:

| Variable | Value |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | The gateway base URL; the .NET SDK appends `/v1/traces`, `/v1/metrics` and `/v1/logs` |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf`; the .NET default is gRPC, while the gateway's `/otlp` path is an OTLP/HTTP endpoint |
| `OTEL_EXPORTER_OTLP_HEADERS` | `Authorization=Basic%20<base64(instance-id:token)>`, the W3C-baggage form of the OTEL headers list: the space is percent-encoded, and base64's `+`, `/` and `=` are legal value characters |
| `OTEL_SERVICE_NAME` | `api` |
| `OTEL_RESOURCE_ATTRIBUTES` | `service.namespace=keyloop-scheduler` |

- Grafana builds `job` from `service.namespace/service.name`, so series carry `job="keyloop-scheduler/api"`, the dashboards' default and alert preparation's `--api-job`. `deployment_environment_name` comes from `ASPNETCORE_ENVIRONMENT`, here `Production`. No `service.instance.id` is set, so series have no `instance` label.
- `container-env-otlp.json` is the core profile plus these variables with a fake token. `CloudflareContainerEnvTests` boots the API with it against a loopback OTLP receiver and checks the paths, the decoded header, the resource attributes, and that no log or export contains the token.
- The token is never logged, returned or sent to the browser. A missing or malformed token refuses the container start with a message naming only the secret.
- Changes apply at the first API request after the deploy ([Configuration changes](#configuration-changes-and-container-restarts)). Export failures never reach the container log, so verify ingestion in Grafana.
- While an exporter is configured, the backlog gauges query the database every 60 s export (ARCHITECTURE section 12.1), so Neon stays awake while the container runs.
- `appsettings.Production.json` raises EF Core's `Microsoft.EntityFrameworkCore.Database.Command`, the `System.Net.Http.HttpClient` handlers and Polly's per-attempt record to `Warning`, keeping per-request logs out of Loki.

## Vehicle-aware booking

With `KEYLOOP_VEHICLE_AWARE_REQUIREMENTS=false` (the default), the container receives no `Scheduling__*` variable and the API keeps its Production value, `false`: a request carrying a vehicle-aware input gets `422 vehicle-aware-requirements-disabled` (ADR-029).
`true` adds `Scheduling__VehicleAwareRequirements=true` to the start environment and its fingerprint, so the first API request after the deploy restarts the container with it.
The API reports the option at the public `GET /api/v1/features` (`{"vehicleAwareRequirements":true}`), and the web app shows the vehicle step, vehicle-aware availability and allocation explanations only while it is `true`.

No secret, binding or account change is needed.
`test/fixtures/container-env-vehicle-aware.json` is pinned by `test/container.test.ts`, and `CloudflareContainerEnvTests` checks the option, `/features` and a vehicle-aware availability request with it.

## Optional intake triage

`KEYLOOP_TRIAGE_ENABLED` defaults to `false`. Enabling it requires `KEYLOOP_TRIAGE_ACCOUNT_ID` (32 hexadecimal characters), optional `KEYLOOP_TRIAGE_GATEWAY_ID` (default `keyloop-scheduler`) and the secret `keyloop_prod_ai_token`, and passes the `Triage__*` settings at container start. No AI token reaches Worker responses or the SPA.

- The API calls Cloudflare's native `/ai/run/@cf/cloudflare/clef-flash` endpoint through the gateway with a Workers AI Read token, with log collection and caching off per request.
  Credits, token provisioning, the gateway, the first live call and public enablement are account-owner operations.
  Keep triage off until they and the LiveAi golden set are approved.
  See [ARCHITECTURE §8.10](../../docs/ARCHITECTURE.md#810-booking-intake-triage).
- Enabling also binds the private R2 bucket `keyloop-scheduler-triage` (override with `KEYLOOP_TRIAGE_BUCKET`) as `TRIAGE_IMAGES`, adds an hourly cleanup cron, and passes `Triage__Model=@cf/cloudflare/clef-flash`, `Triage__ImagesEnabled=true` and `Triage__ImageStoreUrl=http://triage-media.internal`.
  The relay is reachable only from the Container hook and needs no S3 credentials.
  Keep bucket public access disabled, and provision the bucket before deployment.
- Uploads expire after one hour: reads deny expired objects, and the hourly sweep deletes them. `npm run validate:build:integrations` fails without the cron trigger, and the edge tests run the scheduled export against Miniflare R2.

**REQUIRES USER CONFIRMATION:** when provisioning the bucket, add a lifecycle rule that deletes keys under `triage/` one day after upload (`cf r2 bucket lifecycle update`).
It backstops the sweep, because disabling triage removes the binding and the cron.
Uploads require Access sign-in and the Admin or ServiceAdvisor role (ADR-027) but have no global byte quota (ARCHITECTURE §11.1), so watch the bucket's storage usage.

## Access login and API roles

Deploy-time operator work, each step subject to the account owner's confirmation. The evidence and rejected alternatives are in [ADR-027](../../docs/ADR-027.md).

1. **Session.** Confirm the team domain and canonical HTTPS issuer.
   Keep the one-hour application and policy session (both templates say `1h`; the policy's wins).
   The API validates a signed token locally until expiry plus 30 s of skew, so the short lifetime is what bounds a copied token.
   Access issues no refresh token: the web app renews the token two minutes before its end by navigating to `/auth/login`, which succeeds silently while the 24-hour Access account session lasts.
   If the live session was raised as a stopgap, set it back to 1 hour once renewal is deployed.
2. **Application.** One self-hosted application at `keyloop.kylesmile.me/auth/*`. Keep the board, assets and `/api/v1/*` unprotected at Access, so anonymous viewing and JSON 401s work. No hostname-wide Allow requirement and no Bypass policy on writes. Bare `/auth` is not a login entry point.
3. **Cookie.** Disable **Cookie Path Attribute**, enable **HttpOnly**, and choose **SameSite Lax**, part of the API's CSRF defence (ADR-027). The binding cookie protects only Access-protected paths. Confirm the cookie is scoped to the hostname with path `/` and reaches `/api/v1/me`. Do not add a second same-host Access application without revisiting cookie and AUD behaviour.
4. **Identity.** Configure the one-time email PIN for approved reviewers; add Google or GitHub only if approved. Select the allowed IdPs explicitly, and restrict Allow rules to approved emails or domains. Access rule group names do not become API roles.
5. **AUD.** Set `KEYLOOP_ACCESS_TEAM_DOMAIN` and `KEYLOOP_ACCESS_AUDIENCE`. The Worker passes `Auth__Mode=CloudflareAccess`, the issuer and indexed audiences to the container. Never substitute an Access API credential for the application AUD.
6. **Roles.** Supply Admin, ServiceAdvisor and Viewer as comma-separated exact emails or `@domain` entries, outside the repository. Empty lists deny authenticated writes and details. Domains match exactly, case-insensitively, without subdomains. Keep the lists out of commits, reports, screenshots and logs. After a change, rebuild and deploy; the first API request restarts the container with them.
7. **Rehearse** signed-out reads (masked name, VIN and registration, no contact details), each role's writes and details, an authenticated unassigned user (403), expired or malformed sessions (401), and direct-origin requests with spoofed identity (denied).
   `/auth/login?returnTo=%2Fboard` must redirect locally.
   A board left idle past the token's end minus two minutes should renew on its own with a later `expiresAtUtc` from `/api/v1/me`; with a booking in progress it should offer *Stay signed in* instead.
8. **Sign out** at `/cdn-cgi/access/logout`: the hostname cookie is removed, `/api/v1/me` is anonymous, reads are masked and writes answer 401. Copied JWTs keep the offline expiry limitation.
9. **Integrations.** Verify anonymous viewing while triage, email and telemetry are off, and enable each only after its own gate. If the cookie behaviour fails the rehearsal, stop and review a protected API with separate public read paths; never weaken validation.
