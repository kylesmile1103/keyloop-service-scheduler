# Keyloop Cloudflare edge

This project serves the scheduler SPA and routes its API calls to a sleeping .NET Container on `keyloop.kylesmile.me`. It also owns the private email relay and an optional browser OTLP trace relay. Deployment happens later with the stakeholder.

## Local verification

Use Node 22.18 or later within Node 22. The dependencies are pinned in `package-lock.json`, including project-local `cf` and Wrangler. These commands need no Cloudflare account, database, Docker daemon, email destination or Grafana account:

```sh
cd deploy/cloudflare
source ~/.nvm/nvm.sh
nvm exec 22 npm ci --cache ./build/npm-cache --no-audit --no-fund
nvm exec 22 npm run typecheck
nvm exec 22 npm test
nvm exec 22 npm run validate:build
nvm exec 22 npm run validate:build:integrations
```

If no sufficiently recent Node 22 is installed, `nvm install 22` installs it; keep the user's default alias unchanged. Always use the selected version for this project's commands.

`typecheck` first generates Cloudflare runtime and binding types locally. The build validations invoke **only `cf build`**, use dummy resource identifiers and separate fixture assets, disable CLI telemetry, isolate CLI state under this project's ignored directories, and check the emitted routing, bindings and container metadata. The second build includes the optional REST-email and browser-OTLP Secrets Store bindings without reading their values. Neither command assembles or overwrites a real SPA build.

Vitest runs unit tests and actual Static Assets routing in Miniflare. Global network fetches are denied by default; provider responses are explicit fakes. The Miniflare test uses compatibility date `2026-10-11` because its runtime rejects the next UTC date on this machine; the deployment config uses `2026-10-12`. Container lifecycle tests run the real `@cloudflare/containers` class against a fake container runtime (`cloudflare:workers` is aliased to a stub in `vitest.config.ts`), covering the 60-second readiness window for every request during a cold start, coalesced starts and restart configuration. Production egress, placement, real cold-start time and binding access remain deployment checks. `validate:build` also confirms that an invalid setting fails `cf build`.

## Assemble the real SPA

Build `src/Keyloop.ServiceScheduler.Web` with its own documented frontend commands first. From this edge directory, `nvm exec 22 npm run assemble` copies that project's `dist/` into `build/assets/` and adds `public/_headers`. It leaves the frontend output untouched and refuses a missing `dist/index.html` before replacing a prior assembly.

`wrangler.config.ts` is the bundler configuration consumed by `cf`; `cloudflare.config.ts` is the deployment source of truth. Do not add a competing `wrangler.jsonc` unless replacing the cf beta integration deliberately. A local build of the real assembly uses `nvm exec 22 npm run build` with the non-secret resource identifiers below set. Its wrapper disables CLI telemetry and runs only `cf build`. This build consumes an existing API image reference, so it does not build or publish an image.

## Configuration contract

Configure these environment variables when evaluating `cloudflare.config.ts`. They are resource identifiers and policy settings, never credential values. `src/settings.ts` validates them during evaluation, so `cf build` fails on an unknown transport, REST without a 32-character hexadecimal account ID, an enabled OTLP relay without a gateway endpoint, a switch other than `true` or `false`, or an allowlist or cap the container start would refuse. An empty value means the default. Because `cf` evaluates the config with Node's type stripping, modules under `src/` import each other with explicit `.ts` specifiers.

| Variable | Default / meaning |
| --- | --- |
| `KEYLOOP_SECRETS_STORE_ID` | Required existing store ID |
| `KEYLOOP_API_IMAGE` | Required existing registry image reference, immutable SHA tag recommended |
| `KEYLOOP_NOTIFICATIONS_ENABLED` | `false`; passed to the API at container start |
| `KEYLOOP_EMAIL_SENDING_ENABLED` | `false`; independent Worker kill switch |
| `KEYLOOP_EMAIL_TRANSPORT` | `binding`, or explicit `rest` fallback |
| `KEYLOOP_EMAIL_ACCOUNT_ID` | Existing account ID, needed for REST only |
| `KEYLOOP_EMAIL_ALLOWED_ADDRESSES` | Empty; comma-separated approved bare mailboxes |
| `KEYLOOP_EMAIL_ALLOWED_DOMAINS` | Empty; comma-separated exact domains, no wildcard or subdomain expansion |
| `KEYLOOP_EMAIL_MAX_PER_RECIPIENT_PER_DAY` | `10`, valid range 1-1000, enforced by the .NET dispatcher |
| `KEYLOOP_EMAIL_MAX_PER_DAY` | `100`, valid range 1-10000; reduce below the actual account quota |
| `KEYLOOP_OTLP_RELAY_ENABLED` | `false`; binds the browser credential only when `true` |
| `KEYLOOP_GRAFANA_OTLP_ENDPOINT` | Empty; `https://otlp-gateway-<region>.grafana.net/otlp`, without a trailing slash |

The store contains `keyloop_prod_db_url`, a direct Neon TLS connection string for the runtime DML role. REST selection additionally binds `keyloop_prod_email_api_token`; browser relay enablement binds `grafana-otlp-basic-browser`, the base64 encoding of `instance-id:token`. Optional credentials stay in the Worker. Missing DB credentials prevent startup with a sanitised error. DB credential, recipient-policy or API enablement changes require a container restart. A healthy container does not reread Secrets Store on API requests; a request that arrives while the container is still starting reads it once, then waits on the same start.

Only approved recipients can be sent mail. Reserved example/test/invalid/localhost domains are always refused, even if allowlisted. The sender is fixed to `notifications@keyloop.kylesmile.me` and no reply-to is accepted. `test/fixtures/email-relay-request.json` is the JSON contract fixture for the .NET sender's parity test. The relay returns 200 whenever the provider accepted the message, with `messageId` when it is known. An acceptance it cannot fully confirm (a REST 2xx without the recipient echoed as delivered or queued, or a binding result without a message ID) is still 200 and logs `EmailAcceptedUnconfirmed` with the notification ID only, because neither transport has an idempotency key and a retry could duplicate the email. It returns 400 for malformed requests, 422 for permanent refusal, and 503 with `retryable=true` when the provider did not accept the message or the outcome is unknown, such as a timeout. There is no automatic fallback resend.

`/api` and `/api/*` reach the named `api` Durable Object with the `weur` hint. The Worker replaces client forwarding headers before proxying. `/otlp/v1/traces` accepts POST JSON/protobuf, applies fetch-site/origin checks and a 256 KiB streamed size cap, and limits clients to 120/min. `/otlp` and other OTLP paths return JSON 404. Every other path uses Static Assets and SPA fallback, including `/health` and `/scalar`; these paths never expose API internals. `public/_headers` sends host-only HSTS (`max-age=31536000`, no `includeSubDomains` or `preload`) from the first deploy, as decision 9 accepts. This deliberately departs from proposal 4.6, which adds HSTS only after HTTPS enforcement works: the redirect can only be verified once the Custom Domain exists, and browsers record HSTS only from a valid HTTPS response (RFC 6797 section 8.1), so it cannot take effect before the certificate works. To follow the proposal's order instead, remove that line before step 3 and restore it after step 5. The trust contract and deployment profile are in [ARCHITECTURE](../../docs/ARCHITECTURE.md#114-cloudflare-edge-boundary-and-credentials).

## Deployment runbook, REQUIRES USER CONFIRMATION

The committed source of truth is [ARCHITECTURE's Cloudflare deployment view](../../docs/ARCHITECTURE.md#101-cloudflare-deployment-profile) and [ADR-022..024](../../docs/ARCHITECTURE.md#18-architecture-decision-records); the steps below carry its deployment gates. No deployment, account mutation or real send is part of local verification.

1. **REQUIRES USER CONFIRMATION:** create the Neon Free PG17 London project, pin compute to 0.25 CU without autoscaling, apply the owner-role migration bundle, grant the runtime DML role, and populate Secrets Store securely.
2. **REQUIRES USER CONFIRMATION:** prepare the sending subdomain, its six child DNS records and DMARC `p=reject`, disable Email preview, and enforce HTTPS on this hostname. The subdomain preview operation is a POST expected to be non-mutating; include it in the same confirmation as onboarding (F12).
3. Build the SPA and `linux/amd64` API image locally. **REQUIRES USER CONFIRMATION:** publish the image and apply the Worker/Container/Custom Domain configuration. Correct proposal step D21 to use `--provision=false` (F10), inspect the proposed changes first, and keep sending disabled. The static assets carry HSTS from this deploy on, so confirm right afterwards that `http://keyloop.kylesmile.me/` redirects to HTTPS. This task runs no deploy command, including dry-run.
4. **REQUIRES USER CONFIRMATION:** choose exact reviewer addresses, read the account quota and set a lower daily cap. Test outbound handler access and a controlled send to an approved mailbox which is **not** a verified destination before enabling public sending (F3). Temporarily opening the kill switch for that test is itself an approved live action. `E_RECIPIENT_NOT_ALLOWED` requires transport review and possible explicit REST selection; REST HTTP 403 / code 10105 requires resolving account entitlement. No transport switches automatically.
5. **REQUIRES USER CONFIRMATION:** enable integrations after their gates pass. Verify SPA deep links, API navigation JSON, no public health/Scalar/reseed route, trusted client IP and HSTS, reserved-domain suppression, the book/cancel/30-way result, direct Neon TCP 5432 access, and sleep/wake timing. Use a new instance name if the Durable Object was already created without the WEUR hint. Measure cold start against the 60-second port-ready window (F11).

The .NET side must provide `RelayEmailSender`, recipient suppression and cap accounting, stale-notification suppression after sleep, Production-with-demo-data startup without a reseed key, and forwarding middleware before rate limiting. API Grafana export and remote observability resources are separate work. Neon Free compute exhaustion suspends service until the next period or an upgrade; its restore window is six hours (F8). Container log pricing changes on 2026-12-01 (F9).

## Optional intake triage

`KEYLOOP_TRIAGE_ENABLED` defaults to `false`. Enabling it requires `KEYLOOP_TRIAGE_ACCOUNT_ID` (32 hexadecimal characters), optional `KEYLOOP_TRIAGE_GATEWAY_ID` (default `keyloop-scheduler`), and Secrets Store secret `keyloop_prod_ai_token`. The secret binding exists only when enabled. Container startup passes the corresponding `Triage__*` settings; healthy containers retain their start-time credential, so rotation requires a restart. No AI token goes to Worker responses or the SPA.

The API calls Cloudflare's universal `/ai/run` endpoint through the gateway with a Workers AI Read token and log collection/caching off per request. Credits, token provisioning, gateway creation/rate limit, the first live call and public enablement are stakeholder operations. This change adds configuration and local tests only. Keep triage disabled until those steps and the LiveAi golden set are approved. See [ARCHITECTURE §8.10](../../docs/ARCHITECTURE.md#810-booking-intake-triage).
